// Entry point del sidecar: levanta el transporte (WebSocket local) y cablea el
// motor. La UI se conecta, manda { type: "user_message", ... } y recibe un
// stream de EngineEvent.

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";

import {
  registerBuiltinProviders,
  getProvider,
  listProviderIds,
} from "./providers/registry";
import { defaultProviderModel } from "./config/models";
import { hasApiKey, missingKeyMessage } from "./config/secrets";
import { SessionStore } from "./session/store";
import { SnapshotStore } from "./edit/hashline/snapshot-store";
import { readdirWithinProject } from "./tools/fs-safe";
import { MAX_LIST_ENTRIES } from "./config/limits";
import { toolsForAgent, subagentToolsFor } from "./tools/registry";
import { systemPromptFor, subagentPromptFor } from "./engine/agents";
import { runAgent } from "./engine/loop";
import { killProcessTree } from "./tools/start-app";
import type { LlmMessage } from "./providers/types";
import type { DirEntry, EngineEvent, IncomingMessage } from "./engine/events";

// Ruido que el árbol de archivos oculta (el agente sí lo ve vía list_dir).
const TREE_IGNORE = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  ".DS_Store",
]);

/** Lista un directorio dentro de un proyecto para el árbol (carpetas primero). */
async function listDirForTree(
  projectRoot: string,
  path: string,
): Promise<DirEntry[]> {
  const ents = await readdirWithinProject(path, {
    projectRoot,
    snapshots: new SnapshotStore(),
  });
  return ents
    .filter((e) => !TREE_IGNORE.has(e.name))
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    .sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
    )
    .slice(0, MAX_LIST_ENTRIES);
}

/**
 * Resumen de un subagente: el texto del ÚLTIMO mensaje assistant que `runAgent`
 * dejó en su historial. Mismo invariante que usa la UI al retomar sesiones
 * (toLlmHistory): el historial ya quedó completo, no hace falta interceptar el
 * stream.
 */
function finalAssistantText(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = m.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
    if (text.trim()) return text;
  }
  return "(el subagente no devolvió texto)";
}

const PORT = Number(process.env.MYAGENT_SIDECAR_PORT) || 8137;
const HOST = "127.0.0.1";

// Frontera de confianza del WS local. Este socket puede disparar capacidades
// nativas (run_command, start_app, edición de archivos), y los WebSocket NO
// están sujetos a CORS: cualquier página que el usuario abra en un navegador
// podría conectar a ws://127.0.0.1:8137 y manejar el agente. Nos atamos a
// 127.0.0.1 (nadie de la red llega) y ADEMÁS validamos el Origin del handshake
// contra una allowlist EXACTA. El navegador fija el Origin a la página real, así
// que una web atacante no puede falsificarlo; por eso basta con igualdad tras
// parsear la URL — nunca substring/includes ni "*".
const ALLOWED_ORIGINS = new Set(
  process.env.MYAGENT_ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [
    "http://localhost:1420", // vite dev (tauri.conf.json → devUrl)
    "http://127.0.0.1:1420",
    "tauri://localhost", // webview de producción (Linux/macOS)
    "http://tauri.localhost", // webview de producción (Windows)
    "https://tauri.localhost",
  ],
);

/**
 * ¿El Origin del handshake está permitido? Sin Origin = cliente no-navegador
 * (nuestros smoke tests con `ws`, curl, etc.): una web atacante SIEMPRE manda
 * Origin, así que su ausencia no puede ser un ataque cross-site → lo dejamos
 * pasar. Con Origin presente exigimos igualdad exacta de protocolo+host tras
 * parsear con `URL`.
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return ALLOWED_ORIGINS.has(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}

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
process.on("SIGTERM", () => {
  killAllApps();
  process.exit(0);
});
process.on("SIGINT", () => {
  killAllApps();
  process.exit(0);
});

// Si la cáscara que nos lanzó muere (Ctrl-C, crash), nos autoterminamos para no
// quedar huérfanos ocupando el puerto. La cáscara nos pasa su PID por env.
watchParent();

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  // Rechaza el handshake (HTTP 403) si el Origin no está en la allowlist: es la
  // puerta que impide que páginas web arbitrarias hablen con el sidecar.
  verifyClient: ({ origin }, done) => {
    if (originAllowed(origin)) return done(true);
    console.warn(
      `[sidecar] handshake rechazado: origin no permitido (${origin ?? "—"})`,
    );
    done(false, 403, "Origin not allowed");
  },
});

wss.on("listening", () => {
  console.log(`[sidecar] escuchando en ws://${HOST}:${PORT}`);
  console.log(`[sidecar] proveedor=${activeProviderId} modelo=${activeModel}`);
  console.log(
    `[sidecar] proveedores disponibles: ${listProviderIds().join(", ")}`,
  );
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

  emit({
    type: "ready",
    providerId: activeProviderId,
    model: activeModel,
    cwd: process.cwd(),
  });

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
      console.log(
        `[sidecar] reconfigurado: provider=${activeProviderId} model=${activeModel} key=${msg.apiKey ? "***" : "(vacía)"}`,
      );
      emit({
        type: "config_ok",
        providerId: activeProviderId,
        model: activeModel,
      });
      return;
    }

    // Árbol de archivos: listado directo (no pasa por el LLM). Responde con el
    // mismo reqId; en error manda entries vacío + el mensaje.
    if (msg.type === "list_dir") {
      const root = msg.projectPath || process.cwd();
      try {
        const entries = await listDirForTree(root, msg.path || ".");
        emit({
          type: "dir_listing",
          reqId: msg.reqId,
          path: msg.path,
          entries,
        });
      } catch (err) {
        emit({
          type: "dir_listing",
          reqId: msg.reqId,
          path: msg.path,
          entries: [],
          error: (err as Error).message,
        });
      }
      return;
    }

    // Retomar una sesión: reemplaza el historial (o lo vacía). El próximo
    // user_message ya continúa con este contexto. ponytail: los snapshots de
    // edit_file no se restauran — el modelo re-lee antes de editar (lo pide el
    // system prompt), que es el camino correcto tras un reinicio.
    if (msg.type === "load_history") {
      const s = sessions.getOrCreate(
        sessionId,
        msg.projectPath || process.cwd(),
        "build",
      );
      s.messages = Array.isArray(msg.messages) ? msg.messages : [];
      s.snapshots = new SnapshotStore();
      return;
    }

    if (msg.type !== "user_message") return;

    if (running) {
      emit({
        type: "error",
        message: "El agente está ocupado con otro turno.",
      });
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

    session.messages.push({
      role: "user",
      content: [{ type: "text", text: msg.text }],
    });

    running = true;
    controller = new AbortController();
    try {
      // Lifteamos confirm y trackProcess a locals: el ctx del subagente los
      // reusa tal cual (mismo gate de permisos, misma limpieza de procesos).
      const confirm = (req: { command: string; cwd?: string }) =>
        new Promise<boolean>((resolve) => {
          const id = randomUUID();
          pendingPermissions.set(id, resolve);
          emit({
            type: "permission_request",
            id,
            command: req.command,
            cwd: req.cwd,
          });
        });
      const trackProcess = (child: ChildProcess) => {
        apps.push(child);
        allApps.add(child);
      };
      const base = {
        providerId: activeProviderId,
        model: activeModel,
        messages: session.messages,
        ctx: {
          projectRoot: session.projectRoot,
          snapshots: session.snapshots,
          // run_command/start_app piden confirmación: emitimos un
          // permission_request y esperamos el permission_response de la UI.
          confirm,
          // submit_plan (agente Plan) presenta el plan como evento `plan`.
          onPlan: (markdown) => emit({ type: "plan", markdown }),
          // start_app registra su proceso para matarlo al cerrar la sesión
          // (y a nivel global, para que SIGTERM de la cáscara también lo limpie).
          trackProcess,
          // task (subagentes): otra llamada a runAgent con contexto aislado. Acá
          // se cierra sobre provider/model/emit/signal (que la tool no ve). El
          // ctx del hijo NO trae spawnSubagent ni onPlan → profundidad 1 y sin
          // planes anidados. Reusa confirm/trackProcess del padre.
          spawnSubagent: async ({ subagentType, prompt, parentToolId }) => {
            const subMessages: LlmMessage[] = [
              { role: "user", content: [{ type: "text", text: prompt }] },
            ];
            // emit "marcado": estampa parentToolId en los eventos de streaming
            // para que la UI los trate como anidados (los manda a Logs, no al
            // transcript del padre). Sólo esos 4 tipos llevan el campo; el resto
            // (done/error/etc.) pasa tal cual. De paso detectamos errores.
            let failed = false;
            const STAMPED = new Set([
              "assistant_delta",
              "thinking_delta",
              "tool_call",
              "tool_result",
            ]);
            const scopedEmit = (ev: EngineEvent) => {
              if (ev.type === "error") failed = true;
              emit(
                STAMPED.has(ev.type)
                  ? ({ ...ev, parentToolId } as EngineEvent)
                  : ev,
              );
            };
            await runAgent(
              {
                providerId: activeProviderId,
                model: activeModel,
                system: subagentPromptFor(subagentType),
                messages: subMessages,
                tools: subagentToolsFor(subagentType), // nunca incluye `task`
                ctx: {
                  projectRoot: session.projectRoot,
                  snapshots: new SnapshotStore(), // aislado del padre
                  confirm, // se reusa el del padre (mismo gate de permisos)
                  trackProcess, // start_app del subagente igual se limpia
                  // sin onPlan, sin spawnSubagent → profundidad 1
                },
                signal: controller!.signal, // abort del padre corta al hijo
              },
              scopedEmit,
            );
            return { text: finalAssistantText(subMessages), isError: failed };
          },
        },
        signal: controller.signal,
      } satisfies Omit<Parameters<typeof runAgent>[0], "system" | "tools">;

      // E2E = Plan→Build con gate humano. El primer turno PROPONE: corre con el
      // prompt/tools de `plan` (sólo lectura + submit_plan) y se detiene al emitir
      // el plan. La UI lo muestra con botón "Aprobar"; al aprobar reenvía el
      // mensaje con `approve`, y RECIÉN ahí corremos la CONSTRUCCIÓN (prompt/tools
      // de `e2e`: write/edit/run/start_app) sobre el mismo historial. El resto de
      // los agentes corren su fase única directa.
      const phase =
        msg.agentId === "e2e" && !msg.approve ? "plan" : msg.agentId;
      await runAgent(
        {
          ...base,
          system: systemPromptFor(phase),
          tools: toolsForAgent(phase),
        },
        emit,
      );
    } catch (err) {
      emit({
        type: "error",
        message: `Fallo del motor: ${(err as Error).message}`,
      });
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
