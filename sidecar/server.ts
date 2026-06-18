// Entry point del sidecar: levanta el transporte (WebSocket local) y cablea el
// motor. La UI se conecta, manda { type: "user_message", ... } y recibe un
// stream de EngineEvent.

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";

import { registerBuiltinProviders, getProvider, listProviderIds } from "./providers/registry";
import { defaultProviderModel } from "./config/models";
import { hasApiKey, missingKeyMessage } from "./config/secrets";
import { SessionStore } from "./session/store";
import { SnapshotStore } from "./edit/hashline/snapshot-store";
import { readdirWithinProject } from "./tools/fs-safe";
import { MAX_LIST_ENTRIES } from "./config/limits";
import { toolsForAgent } from "./tools/registry";
import { systemPromptFor } from "./engine/agents";
import { runAgent } from "./engine/loop";
import { killProcessTree } from "./tools/start-app";
import type { DirEntry, EngineEvent, IncomingMessage } from "./engine/events";

// Ruido que el árbol de archivos oculta (el agente sí lo ve vía list_dir).
const TREE_IGNORE = new Set([".git", "node_modules", "target", "dist", ".DS_Store"]);

/** Lista un directorio dentro de un proyecto para el árbol (carpetas primero). */
async function listDirForTree(projectRoot: string, path: string): Promise<DirEntry[]> {
  const ents = await readdirWithinProject(path, {
    projectRoot,
    snapshots: new SnapshotStore(),
  });
  return ents
    .filter((e) => !TREE_IGNORE.has(e.name))
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    .slice(0, MAX_LIST_ENTRIES);
}

const PORT = Number(process.env.MYAGENT_SIDECAR_PORT) || 8137;
const HOST = "127.0.0.1";

registerBuiltinProviders();
const initial = defaultProviderModel();
// Activos: arrancan con los defaults de env, se pueden reconfigurar al vuelo
// con un mensaje "set_config" desde la UI.
let activeProviderId = initial.providerId;
let activeModel = initial.model;
const sessions = new SessionStore();

// Rastro global de apps de larga duración (start_app) para que los handlers de
// SIGTERM/SIGINT puedan matarlas. ws.on("close") sólo corre en desconexiones
// limpias; las señales no lo disparan, y Tauri nos manda SIGTERM al cerrar.
const allApps = new Set<ChildProcess>();
const killAllApps = () => {
  for (const c of allApps) killProcessTree(c);
  allApps.clear();
};
process.on("SIGTERM", () => { killAllApps(); process.exit(0); });
process.on("SIGINT", () => { killAllApps(); process.exit(0); });

// Si la cáscara que nos lanzó muere (Ctrl-C, crash), nos autoterminamos para no
// quedar huérfanos ocupando el puerto. La cáscara nos pasa su PID por env.
watchParent();

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("listening", () => {
  console.log(`[sidecar] escuchando en ws://${HOST}:${PORT}`);
  console.log(`[sidecar] proveedor=${activeProviderId} modelo=${activeModel}`);
  console.log(`[sidecar] proveedores disponibles: ${listProviderIds().join(", ")}`);
});

function watchParent(): void {
  const parent = Number(process.env.MYAGENT_PARENT_PID);
  if (!parent) return;
  setInterval(() => {
    try {
      process.kill(parent, 0); // señal 0 = "¿existe?"
    } catch {
      console.log("[sidecar] la cáscara murió; cerrando.");
      process.exit(0);
    }
  }, 2000).unref();
}

wss.on("connection", (ws: WebSocket) => {
  const sessionId = randomUUID();
  let running = false;
  let controller: AbortController | undefined;

  // Apps de larga duración arrancadas con start_app: las matamos al cerrar la
  // sesión para no dejar servidores de dev huérfanos. ponytail: viven hasta el
  // close; no las matamos en abort (abort corta el turno, no la app levantada).
  const apps: ChildProcess[] = [];

  // Confirmaciones de run_command pendientes: id → resolver de la promesa que
  // el loop está esperando. Se resuelven con la respuesta del usuario, o con
  // `false` si el turno se aborta o la conexión se cierra.
  const pendingPermissions = new Map<string, (approved: boolean) => void>();
  const drainPermissions = () => {
    for (const resolve of pendingPermissions.values()) resolve(false);
    pendingPermissions.clear();
  };

  const emit = (event: EngineEvent) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };

  emit({ type: "ready", providerId: activeProviderId, model: activeModel, cwd: process.cwd() });

  ws.on("message", async (raw) => {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(raw.toString()) as IncomingMessage;
    } catch {
      emit({ type: "error", message: "Mensaje no es JSON válido." });
      return;
    }

    if (msg.type === "abort") {
      controller?.abort();
      // Un comando en confirmación quedaría colgado esperando respuesta: lo
      // resolvemos como denegado para que el loop pueda cerrar el turno.
      drainPermissions();
      return;
    }

    if (msg.type === "permission_response") {
      const resolve = pendingPermissions.get(msg.id);
      if (resolve) {
        pendingPermissions.delete(msg.id);
        resolve(msg.approved);
      }
      return;
    }

    if (msg.type === "set_config") {
      try {
        // Tira si el providerId no está registrado: la UI debe respetar
        // listProviderIds() y nunca mandar uno inválido.
        const provider = getProvider(msg.providerId);
        provider.setApiKey?.(msg.apiKey);
      } catch (err) {
        emit({ type: "error", message: (err as Error).message });
        return;
      }
      activeProviderId = msg.providerId;
      activeModel = msg.model;
      // ponytail: log mínimo para que la UI tenga señal visible en la terminal
      // de que el mensaje llegó (antes el handler era no-op en builds viejos).
      console.log(`[sidecar] reconfigurado: provider=${activeProviderId} model=${activeModel} key=${msg.apiKey ? "***" : "(vacía)"}`);
      emit({ type: "config_ok", providerId: activeProviderId, model: activeModel });
      return;
    }

    // Árbol de archivos: listado directo (no pasa por el LLM). Responde con el
    // mismo reqId; en error manda entries vacío + el mensaje.
    if (msg.type === "list_dir") {
      const root = msg.projectPath || process.cwd();
      try {
        const entries = await listDirForTree(root, msg.path || ".");
        emit({ type: "dir_listing", reqId: msg.reqId, path: msg.path, entries });
      } catch (err) {
        emit({ type: "dir_listing", reqId: msg.reqId, path: msg.path, entries: [], error: (err as Error).message });
      }
      return;
    }

    // Retomar una sesión: reemplaza el historial (o lo vacía). El próximo
    // user_message ya continúa con este contexto. ponytail: los snapshots de
    // edit_file no se restauran — el modelo re-lee antes de editar (lo pide el
    // system prompt), que es el camino correcto tras un reinicio.
    if (msg.type === "load_history") {
      const s = sessions.getOrCreate(sessionId, msg.projectPath || process.cwd(), "build");
      s.messages = Array.isArray(msg.messages) ? msg.messages : [];
      s.snapshots = new SnapshotStore();
      return;
    }

    if (msg.type !== "user_message") return;

    if (running) {
      emit({ type: "error", message: "El agente está ocupado con otro turno." });
      return;
    }

    const projectRoot = msg.projectPath || process.cwd();
    const session = sessions.getOrCreate(sessionId, projectRoot, msg.agentId);
    session.agentId = msg.agentId;
    session.projectRoot = projectRoot;

    // Validar la key ANTES de persistir el mensaje: si lo empujáramos primero y
    // saliéramos por falta de key, el mensaje quedaría en session.messages y el
    // próximo turno válido lo reenviaría al LLM como si fuera nuevo.
    if (!hasApiKey(activeProviderId)) {
      emit({ type: "error", message: missingKeyMessage(activeProviderId) });
      return;
    }

    session.messages.push({ role: "user", content: [{ type: "text", text: msg.text }] });

    running = true;
    controller = new AbortController();
    try {
      const base = {
        providerId: activeProviderId,
        model: activeModel,
        messages: session.messages,
        ctx: {
          projectRoot: session.projectRoot,
          snapshots: session.snapshots,
          // run_command/start_app piden confirmación: emitimos un
          // permission_request y esperamos el permission_response de la UI.
          confirm: (req) =>
            new Promise<boolean>((resolve) => {
              const id = randomUUID();
              pendingPermissions.set(id, resolve);
              emit({ type: "permission_request", id, command: req.command, cwd: req.cwd });
            }),
          // submit_plan (agente Plan) presenta el plan como evento `plan`.
          onPlan: (markdown) => emit({ type: "plan", markdown }),
          // start_app registra su proceso para matarlo al cerrar la sesión
          // (y a nivel global, para que SIGTERM de la cáscara también lo limpie).
          trackProcess: (child) => { apps.push(child); allApps.add(child); },
        },
        signal: controller.signal,
      } satisfies Omit<Parameters<typeof runAgent>[0], "system" | "tools">;

      // E2E = Plan→Build con gate humano. El primer turno PROPONE: corre con el
      // prompt/tools de `plan` (sólo lectura + submit_plan) y se detiene al emitir
      // el plan. La UI lo muestra con botón "Aprobar"; al aprobar reenvía el
      // mensaje con `approve`, y RECIÉN ahí corremos la CONSTRUCCIÓN (prompt/tools
      // de `e2e`: write/edit/run/start_app) sobre el mismo historial. El resto de
      // los agentes corren su fase única directa.
      const phase = msg.agentId === "e2e" && !msg.approve ? "plan" : msg.agentId;
      await runAgent(
        { ...base, system: systemPromptFor(phase), tools: toolsForAgent(phase) },
        emit,
      );
    } catch (err) {
      emit({ type: "error", message: `Fallo del motor: ${(err as Error).message}` });
    } finally {
      running = false;
      controller = undefined;
    }
  });

  ws.on("close", () => {
    controller?.abort();
    drainPermissions();
    // Matar las apps de larga duración (start_app) para no dejarlas huérfanas.
    for (const child of apps) {
      allApps.delete(child);
      killProcessTree(child);
    }
    sessions.delete(sessionId);
  });
});

wss.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[sidecar] el puerto ${PORT} ya está en uso (¿quedó un sidecar viejo?). ` +
        `Cerralo o cambiá MYAGENT_SIDECAR_PORT.`,
    );
    process.exit(1);
  }
  console.error("[sidecar] error del WebSocketServer:", err);
});
