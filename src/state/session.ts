// Store de Zustand: estado compartido de la sesión + las acciones que el
// cliente de transporte invoca al recibir cada evento del motor. El streaming
// muta el store y React re-renderiza solo (los componentes leen con selectores).

import { create } from "zustand";
import type { AgentId } from "../transport/protocol";
import type { StoredSession } from "./history";

const PROJECT_KEY = "myagent:projectPath";

export interface UiToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  done: boolean;
}

/**
 * Entrada del log de desarrollo. Captura el tráfico crudo con el sidecar para
 * diagnosticar "el agente no responde": `dir` indica la dirección (← entrante,
 * → saliente, • sistema/conexión), `level` resalta los errores en rojo, y
 * `detail` (opcional) guarda el JSON/payload completo, mostrado plegado.
 * Las entradas `stream` coalescen los deltas de streaming en una sola fila.
 */
export interface LogEntry {
  id: number;
  ts: number;
  dir: "in" | "out" | "sys";
  level: "info" | "error";
  text: string;
  detail?: string;
  /** Si está presente, esta fila acumula deltas de streaming de ese tipo. */
  stream?: string;
  /** Caracteres acumulados en una fila de streaming. */
  bytes?: number;
}

/** Tope del buffer: descartamos las entradas más viejas para no crecer sin fin. */
const MAX_LOGS = 600;
let logSeq = 0;

function capLogs(logs: LogEntry[]): LogEntry[] {
  return logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs;
}

/** Plan emitido por el agente Plan, adjunto a su mensaje de asistente. */
export interface UiPlan {
  markdown: string;
  approved: boolean;
}

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: UiToolCall[]; plan?: UiPlan; thinking?: string };

/** Confirmación de comando pendiente (run_command esperando al usuario). */
export interface PendingPermission {
  id: string;
  command: string;
  cwd?: string;
}

interface SessionState {
  agentId: AgentId;
  messages: Message[];
  streaming: boolean;
  connected: boolean;
  providerId?: string;
  model?: string;
  logs: LogEntry[];
  /** Carpeta del proyecto activo (la elige ProjectPicker; default = cwd del sidecar). */
  projectPath?: string;
  /** Id de la sesión actual (para persistir/retomar). Se crea al primer turno. */
  sessionId?: string;
  /** Texto a insertar en el composer (lo dispara un clic en el árbol). */
  pendingInsert?: string;
  /** Comando esperando confirmación humana (run_command). */
  pendingPermission?: PendingPermission;

  setAgent(id: AgentId): void;
  setConnected(connected: boolean): void;
  onReady(providerId: string, model: string): void;
  setProjectPath(path: string): void;
  /** Default del proyecto (cwd del sidecar) — sólo si el usuario no eligió uno. */
  setDefaultProject(cwd: string): void;
  /** Empieza una sesión nueva y vacía (mantiene agente y proyecto). */
  newSession(): void;
  /** Carga una sesión guardada en la UI (el transcript y su agente/proyecto). */
  loadSession(s: StoredSession): void;
  /** Pide insertar texto en el composer (lo consume el Composer y lo limpia). */
  insertIntoComposer(text: string): void;
  consumeInsert(): void;

  // Log de desarrollo: lo alimenta transport/client.ts; lo lee LogsPanel.
  pushLog(entry: Omit<LogEntry, "id" | "ts">): void;
  appendStreamLog(dir: LogEntry["dir"], stream: string, text: string): void;
  clearLogs(): void;

  // Acciones llamadas por transport/client.ts con cada evento del motor.
  startUserTurn(text: string): void; // agrega msg user + msg assistant vacío
  appendAssistantDelta(text: string): void;
  appendThinkingDelta(text: string): void; // razonamiento del modelo (estilo Cursor)
  addToolCall(id: string, name: string, input: unknown): void;
  resolveToolCall(id: string, output: string, isError: boolean): void;
  setPlan(markdown: string): void; // adjunta el plan al último mensaje del asistente
  approveLastPlan(): void; // marca como aprobado el plan más reciente
  setPendingPermission(p: PendingPermission): void;
  clearPendingPermission(): void;
  finishTurn(): void;
  pushErrorNote(message: string): void;
}

// Helpers para actualizar el ÚLTIMO mensaje del asistente de forma inmutable.
function updateLastAssistant(
  messages: Message[],
  fn: (m: Extract<Message, { role: "assistant" }>) => Extract<Message, { role: "assistant" }>,
): Message[] {
  const idx = lastAssistantIndex(messages);
  if (idx === -1) return messages;
  const copy = messages.slice();
  copy[idx] = fn(copy[idx] as Extract<Message, { role: "assistant" }>);
  return copy;
}

function lastAssistantIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return i;
  }
  return -1;
}

export const useSession = create<SessionState>((set) => ({
  agentId: "build",
  messages: [],
  streaming: false,
  connected: false,
  logs: [],
  projectPath: localStorage.getItem(PROJECT_KEY) ?? undefined,

  setAgent: (agentId) => set({ agentId }),
  setConnected: (connected) => set({ connected }),
  onReady: (providerId, model) => set({ providerId, model, connected: true }),

  setProjectPath: (path) => {
    localStorage.setItem(PROJECT_KEY, path);
    set({ projectPath: path });
  },
  setDefaultProject: (cwd) =>
    set((s) => (s.projectPath ? {} : { projectPath: cwd })),

  newSession: () =>
    set({ messages: [], sessionId: crypto.randomUUID(), streaming: false, pendingPermission: undefined }),

  loadSession: (s) =>
    set((prev) => ({
      messages: s.messages,
      agentId: s.agentId,
      projectPath: s.projectPath ?? prev.projectPath,
      sessionId: s.id,
      streaming: false,
      pendingPermission: undefined,
    })),

  pushLog: (entry) =>
    set((s) => ({
      logs: capLogs([...s.logs, { ...entry, id: ++logSeq, ts: Date.now() }]),
    })),

  // Coalesce: si la última fila ya es un stream del mismo tipo y contigua,
  // le sumamos los caracteres en vez de empujar cientos de filas de deltas.
  appendStreamLog: (dir, stream, text) =>
    set((s) => {
      const last = s.logs[s.logs.length - 1];
      if (last && last.stream === stream) {
        const bytes = (last.bytes ?? 0) + text.length;
        const merged: LogEntry = {
          ...last,
          bytes,
          text: `${stream} · ${bytes} chars`,
          detail: ((last.detail ?? "") + text).slice(-2000),
        };
        return { logs: [...s.logs.slice(0, -1), merged] };
      }
      const entry: LogEntry = {
        id: ++logSeq,
        ts: Date.now(),
        dir,
        level: "info",
        stream,
        bytes: text.length,
        text: `${stream} · ${text.length} chars`,
        detail: text.slice(-2000),
      };
      return { logs: capLogs([...s.logs, entry]) };
    }),

  clearLogs: () => set({ logs: [] }),

  startUserTurn: (text) =>
    set((s) => ({
      streaming: true,
      sessionId: s.sessionId ?? crypto.randomUUID(),
      messages: [
        ...s.messages,
        { role: "user", text },
        { role: "assistant", text: "", toolCalls: [] },
      ],
    })),

  appendAssistantDelta: (text) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({ ...m, text: m.text + text })),
    })),

  appendThinkingDelta: (text) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({ ...m, thinking: (m.thinking ?? "") + text })),
    })),

  addToolCall: (id, name, input) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        toolCalls: [...m.toolCalls, { id, name, input, done: false }],
      })),
    })),

  resolveToolCall: (id, output, isError) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.id === id ? { ...t, output, isError, done: true } : t,
        ),
      })),
    })),

  setPlan: (markdown) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        plan: { markdown, approved: false },
      })),
    })),

  approveLastPlan: () =>
    set((s) => {
      // Marca aprobado el plan más reciente (el único accionable).
      for (let i = s.messages.length - 1; i >= 0; i--) {
        const m = s.messages[i];
        if (m.role === "assistant" && m.plan && !m.plan.approved) {
          const copy = s.messages.slice();
          copy[i] = { ...m, plan: { ...m.plan, approved: true } };
          return { messages: copy };
        }
      }
      return {};
    }),

  insertIntoComposer: (text) => set({ pendingInsert: text }),
  consumeInsert: () => set({ pendingInsert: undefined }),

  setPendingPermission: (pendingPermission) => set({ pendingPermission }),
  clearPendingPermission: () => set({ pendingPermission: undefined }),

  // Al terminar o fallar el turno, una confirmación pendiente ya no aplica.
  finishTurn: () => set({ streaming: false, pendingPermission: undefined }),

  pushErrorNote: (message) =>
    set((s) => ({
      streaming: false,
      pendingPermission: undefined,
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        text: m.text ? `${m.text}\n\n⚠️ ${message}` : `⚠️ ${message}`,
      })),
    })),
}));
