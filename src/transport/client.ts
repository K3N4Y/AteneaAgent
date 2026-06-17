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

  ws = new WebSocket(URL);

  ws.onopen = () => {
    useSession.getState().setConnected(true);
  };

  ws.onmessage = (e) => {
    let event: IncomingEvent;
    try {
      event = JSON.parse(e.data) as IncomingEvent;
    } catch {
      return;
    }
    dispatch(event);
  };

  ws.onclose = () => {
    useSession.getState().setConnected(false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose se dispara a continuación y agenda el reintento.
    ws?.close();
  };
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

function send(msg: OutgoingMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
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
