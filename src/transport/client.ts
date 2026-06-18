// Cliente de transporte: conecta al WebSocket local del sidecar, mapea cada
// IncomingEvent a la acción correspondiente del store, y expone el envío de
// mensajes del usuario. Reconecta solo si el sidecar todavía no está arriba.

import { useSession } from "../state/session";
import type { Message } from "../state/session";
import { saveSession, titleFor, type StoredSession } from "../state/history";
import type { DirEntry, IncomingEvent, LlmMessage, OutgoingMessage } from "./protocol";

// Debe coincidir con el puerto por defecto del sidecar (sidecar/server.ts y la
// cáscara Rust). Override con VITE_SIDECAR_PORT en dev si hiciera falta.
const PORT = Number(import.meta.env.VITE_SIDECAR_PORT) || 8137;
const URL = `ws://127.0.0.1:${PORT}`;

let ws: WebSocket | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
// list_dir pendientes: reqId → resolver de las entradas (para el árbol).
const pendingDirs = new Map<string, (entries: DirEntry[]) => void>();
let dirSeq = 0;

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
    case "permission_request":
      store.pushLog({
        dir: "in",
        level: "info",
        text: `permission_request · ${ev.command}`,
        detail: ev.cwd ? `cwd: ${ev.cwd}` : undefined,
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
    case "permission_response":
      text = `permission_response · ${msg.approved ? "aprobado" : "rechazado"}`;
      break;
    case "list_dir":
      text = `list_dir · ${msg.path}`;
      break;
    case "load_history":
      text = `load_history · ${msg.messages.length} msgs`;
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
      // El cwd del sidecar es el proyecto por defecto si el usuario no eligió uno.
      s.setDefaultProject(event.cwd);
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
      s.appendThinkingDelta(event.text);
      break;
    case "tool_call":
      s.addToolCall(event.id, event.name, event.input);
      break;
    case "tool_result":
      s.resolveToolCall(event.id, event.output, event.isError);
      break;
    case "permission_request":
      s.setPendingPermission({ id: event.id, command: event.command, cwd: event.cwd });
      break;
    case "dir_listing": {
      const resolve = pendingDirs.get(event.reqId);
      if (resolve) {
        pendingDirs.delete(event.reqId);
        resolve(event.entries);
      }
      break;
    }
    case "plan":
      s.setPlan(event.markdown);
      break;
    case "done":
      s.finishTurn();
      persistCurrent();
      break;
    case "error":
      s.pushErrorNote(event.message);
      persistCurrent();
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
  const { agentId, projectPath, startUserTurn } = useSession.getState();
  startUserTurn(trimmed);
  send({ type: "user_message", text: trimmed, agentId, projectPath });
  persistCurrent();
}

/** Pide al sidecar el contenido de un directorio del proyecto (para el árbol). */
export function requestDir(path: string): Promise<DirEntry[]> {
  const reqId = `d${++dirSeq}`;
  const projectPath = useSession.getState().projectPath;
  return new Promise((resolve) => {
    if (!Boolean(ws && ws.readyState === WebSocket.OPEN)) {
      resolve([]);
      return;
    }
    pendingDirs.set(reqId, resolve);
    send({ type: "list_dir", reqId, path, projectPath });
    // Red de seguridad: si el sidecar nunca responde, no dejamos la promesa colgada.
    setTimeout(() => {
      if (pendingDirs.delete(reqId)) resolve([]);
    }, 5000);
  });
}

/** Persiste la sesión actual en localStorage (transcript + agente + proyecto). */
function persistCurrent(): void {
  const s = useSession.getState();
  if (!s.sessionId) return;
  const session: StoredSession = {
    id: s.sessionId,
    title: titleFor(s.messages),
    updatedAt: Date.now(),
    agentId: s.agentId,
    projectPath: s.projectPath,
    messages: s.messages,
  };
  saveSession(session);
}

/** Empieza una sesión nueva: limpia la UI y vacía el historial del sidecar. */
export function startNewSession(): void {
  useSession.getState().newSession();
  send({ type: "load_history", messages: [], projectPath: useSession.getState().projectPath });
}

/** Retoma una sesión guardada: carga el transcript y reconstruye el contexto
 * del sidecar (mensajes normalizados, incluidas las tool calls). */
export function resumeSession(stored: StoredSession): void {
  const s = useSession.getState();
  s.loadSession(stored);
  send({
    type: "load_history",
    messages: toLlmHistory(stored.messages),
    projectPath: stored.projectPath ?? s.projectPath,
  });
}

/**
 * Reconstruye el historial normalizado (LlmMessage[]) desde el transcript de la
 * UI para retomar una sesión. Cada mensaje del asistente con tool calls genera
 * un mensaje assistant (texto + tool_use) seguido de un user con los
 * tool_result. Sólo se incluyen tool calls TERMINADAS para que cada tool_use
 * tenga su tool_result (Anthropic lo exige); las a medio terminar se descartan.
 */
function toLlmHistory(messages: Message[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: m.text }] });
      continue;
    }
    const done = m.toolCalls.filter((t) => t.done);
    if (!m.text && done.length === 0) continue; // placeholder vacío o turno cortado
    const content: LlmMessage["content"] = [];
    if (m.text) content.push({ type: "text", text: m.text });
    for (const t of done) content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
    out.push({ role: "assistant", content });
    if (done.length > 0) {
      out.push({
        role: "user",
        content: done.map((t) => ({
          type: "tool_result",
          toolUseId: t.id,
          output: t.output ?? "",
          isError: t.isError ?? false,
        })),
      });
    }
  }
  return out;
}

/** Abortar el turno en curso. */
export function abortTurn(): void {
  send({ type: "abort" });
}

/** Responder a una confirmación de comando (run_command). */
export function respondPermission(id: string, approved: boolean): void {
  useSession.getState().clearPendingPermission();
  send({ type: "permission_response", id, approved });
}

/**
 * Aprobar el plan propuesto por el agente Plan: lo marca como aprobado, cambia
 * al agente Build y le pide implementarlo. El plan ya está en el historial de
 * la sesión, así que Build lo ve como contexto.
 */
export function approvePlan(): void {
  const s = useSession.getState();
  s.approveLastPlan();
  s.setAgent("build");
  sendUserMessage("Implementá el plan aprobado, paso a paso.");
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
