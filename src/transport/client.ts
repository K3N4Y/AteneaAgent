// Cliente de transporte: conecta al WebSocket local del sidecar, mapea cada
// IncomingEvent a la acción correspondiente del store, y expone el envío de
// mensajes del usuario. Reconecta solo si el sidecar todavía no está arriba.

import { useSession } from "../state/session";
import type { IncomingEvent, OutgoingMessage } from "./protocol";

// Debe coincidir con el puerto por defecto del sidecar (sidecar/server.ts y la
// cáscara Rust). Override con VITE_SIDECAR_PORT en dev si hiciera falta.
const PORT = Number(import.meta.env.VITE_SIDECAR_PORT) || 8137;
const URL = `ws://127.0.0.1:${PORT}`;

let ws: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

export function connectSidecar(): void {
  // Evita conexiones duplicadas (StrictMode monta dos veces en dev).
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  logSys("info", `Conectando a ${URL}…`);
  ws = new WebSocket(URL);

  ws.onopen = () => {
    useSession.getState().setConnected(true);
    logSys("info", "WebSocket abierto");
  };

  ws.onmessage = (e) => {
    let event: IncomingEvent;
    try {
      event = JSON.parse(e.data) as IncomingEvent;
    } catch {
      logSys("error", "Mensaje entrante no es JSON válido", String(e.data));
      return;
    }
    logIncoming(event);
    dispatch(event);
  };

  ws.onclose = (e) => {
    useSession.getState().setConnected(false);
    logSys("info", `WebSocket cerrado (code=${e.code}${e.reason ? `, ${e.reason}` : ""})`);
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose se dispara a continuación y agenda el reintento.
    logSys("error", "Error de WebSocket (¿el sidecar está arriba en el puerto 8137?)");
    ws?.close();
  };
}

// ── Log de desarrollo ───────────────────────────────────────────────────────
// Reflejamos en el panel de Logs todo lo que cruza el WebSocket, para poder
// diagnosticar por qué el agente no responde sin abrir la terminal del sidecar.

function logSys(level: "info" | "error", text: string, detail?: string): void {
  useSession.getState().pushLog({ dir: "sys", level, text, detail });
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Registra cada evento entrante del motor (los deltas se coalescen). */
function logIncoming(ev: IncomingEvent): void {
  const store = useSession.getState();
  switch (ev.type) {
    case "assistant_delta":
      store.appendStreamLog("in", "assistant_delta", ev.text);
      return;
    case "thinking_delta":
      store.appendStreamLog("in", "thinking_delta", ev.text);
      return;
    case "ready":
      store.pushLog({ dir: "in", level: "info", text: `ready · provider=${ev.providerId} model=${ev.model}` });
      return;
    case "config_ok":
      store.pushLog({ dir: "in", level: "info", text: `config_ok · provider=${ev.providerId} model=${ev.model}` });
      return;
    case "tool_call":
      store.pushLog({ dir: "in", level: "info", text: `tool_call · ${ev.name}`, detail: pretty(ev.input) });
      return;
    case "tool_result":
      store.pushLog({
        dir: "in",
        level: ev.isError ? "error" : "info",
        text: `tool_result · ${ev.name} · ${ev.isError ? "ERROR" : "ok"} · ${ev.output.length} chars`,
        detail: ev.output.slice(0, 2000),
      });
      return;
    case "plan":
      store.pushLog({ dir: "in", level: "info", text: `plan · ${ev.markdown.length} chars`, detail: ev.markdown.slice(0, 2000) });
      return;
    case "done":
      store.pushLog({ dir: "in", level: "info", text: "done", detail: ev.usage ? pretty(ev.usage) : undefined });
      return;
    case "error":
      store.pushLog({ dir: "in", level: "error", text: `error · ${ev.message}` });
      return;
  }
}

/** Registra cada mensaje saliente; marca el descarte si el WS no está abierto. */
function logOutgoing(msg: OutgoingMessage, sent: boolean): void {
  let text: string;
  let detail: string | undefined;
  switch (msg.type) {
    case "user_message":
      text = `user_message · agent=${msg.agentId}`;
      detail = msg.text;
      break;
    case "abort":
      text = "abort";
      break;
    case "set_config":
      // La API key NUNCA se registra: sólo si venía o no.
      text = `set_config · provider=${msg.providerId} model=${msg.model} key=${msg.apiKey ? "presente" : "(vacía)"}`;
      break;
  }
  if (sent) {
    useSession.getState().pushLog({ dir: "out", level: "info", text, detail });
  } else {
    useSession.getState().pushLog({
      dir: "out",
      level: "error",
      text: `${text} — DESCARTADO (WebSocket no abierto)`,
      detail,
    });
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectSidecar();
  }, 800);
}

function dispatch(event: IncomingEvent): void {
  const s = useSession.getState();
  switch (event.type) {
    case "ready":
      s.onReady(event.providerId, event.model);
      // Si el usuario ya tenía provider/model persistidos al cargar la app,
      // los reenviamos al sidecar apenas abre el WS: así el sidecar siempre
      // refleja lo que la UI tiene guardado, sin esperar a que abran el modal.
      syncPersistedConfig();
      break;
    case "config_ok":
      s.onReady(event.providerId, event.model);
      break;
    case "assistant_delta":
      s.appendAssistantDelta(event.text);
      break;
    case "thinking_delta":
      // En Fase 0 no mostramos el razonamiento; se ignora.
      break;
    case "tool_call":
      s.addToolCall(event.id, event.name, event.input);
      break;
    case "tool_result":
      s.resolveToolCall(event.id, event.output, event.isError);
      break;
    case "plan":
      // PlanView llega en Fase 1; por ahora lo tratamos como texto.
      s.appendAssistantDelta(event.markdown);
      break;
    case "done":
      s.finishTurn();
      break;
    case "error":
      s.pushErrorNote(event.message);
      break;
  }
}

/**
 * Lee de localStorage y, si hay provider/model guardados, los manda al
 * sidecar. Se llama una vez por conexión. La key sólo se reenvía si hay
 * provider persistido (la UI la guarda por providerId; la cargamos al
 * construir el modal y al guardar).
 */
function syncPersistedConfig(): void {
  const providerId = localStorage.getItem("myagent:provider");
  const model = localStorage.getItem("myagent:model");
  if (!providerId || !model) return;
  const apiKey = localStorage.getItem(`myagent:apiKey:${providerId}`) ?? undefined;
  send({ type: "set_config", providerId, model, apiKey });
}

function send(msg: OutgoingMessage): void {
  const open = Boolean(ws && ws.readyState === WebSocket.OPEN);
  if (open) {
    ws!.send(JSON.stringify(msg));
  }
  logOutgoing(msg, open);
}

/** Enviar un mensaje del usuario: actualiza el store y manda al sidecar. */
export function sendUserMessage(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const { agentId, startUserTurn } = useSession.getState();
  startUserTurn(trimmed);
  send({ type: "user_message", text: trimmed, agentId });
}

/** Abortar el turno en curso. */
export function abortTurn(): void {
  send({ type: "abort" });
}

/** Reconfigura proveedor/modelo/key al vuelo. Persiste en localStorage. */
export function sendSetConfig(providerId: string, model: string, apiKey: string): void {
  localStorage.setItem("myagent:provider", providerId);
  localStorage.setItem("myagent:model", model);
  if (apiKey) {
    localStorage.setItem(`myagent:apiKey:${providerId}`, apiKey);
  } else {
    localStorage.removeItem(`myagent:apiKey:${providerId}`);
  }
  useSession.getState().onReady(providerId, model);
  send({ type: "set_config", providerId, model, apiKey: apiKey || undefined });
}
