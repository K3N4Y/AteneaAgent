// Entry point del sidecar: levanta el transporte (WebSocket local) y cablea el
// motor. La UI se conecta, manda { type: "user_message", ... } y recibe un
// stream de EngineEvent.

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

import { registerBuiltinProviders, getProvider, listProviderIds } from "./providers/registry";
import { defaultProviderModel } from "./config/models";
import { hasApiKey, missingKeyMessage } from "./config/secrets";
import { SessionStore } from "./session/store";
import { toolsForAgent } from "./tools/registry";
import { systemPromptFor } from "./engine/agents";
import { runAgent } from "./engine/loop";
import type { EngineEvent, IncomingMessage } from "./engine/events";

const PORT = Number(process.env.MYAGENT_SIDECAR_PORT) || 8137;
const HOST = "127.0.0.1";

registerBuiltinProviders();
const initial = defaultProviderModel();
// Activos: arrancan con los defaults de env, se pueden reconfigurar al vuelo
// con un mensaje "set_config" desde la UI.
let activeProviderId = initial.providerId;
let activeModel = initial.model;
const sessions = new SessionStore();

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

  const emit = (event: EngineEvent) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };

  emit({ type: "ready", providerId: activeProviderId, model: activeModel });

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
      await runAgent(
        {
          providerId: activeProviderId,
          model: activeModel,
          system: systemPromptFor(msg.agentId),
          messages: session.messages,
          tools: toolsForAgent(msg.agentId),
          ctx: { projectRoot: session.projectRoot, snapshots: session.snapshots },
          signal: controller.signal,
        },
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
