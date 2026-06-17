// Store de Zustand: estado compartido de la sesión + las acciones que el
// cliente de transporte invoca al recibir cada evento del motor. El streaming
// muta el store y React re-renderiza solo (los componentes leen con selectores).

import { create } from "zustand";
import type { AgentId } from "../transport/protocol";

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

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: UiToolCall[] };

interface SessionState {
  agentId: AgentId;
  messages: Message[];
  streaming: boolean;
  connected: boolean;
  providerId?: string;
  model?: string;
  logs: LogEntry[];

  setAgent(id: AgentId): void;
  setConnected(connected: boolean): void;
  onReady(providerId: string, model: string): void;

  // Log de desarrollo: lo alimenta transport/client.ts; lo lee LogsPanel.
  pushLog(entry: Omit<LogEntry, "id" | "ts">): void;
  appendStreamLog(dir: LogEntry["dir"], stream: string, text: string): void;
  clearLogs(): void;

  // Acciones llamadas por transport/client.ts con cada evento del motor.
  startUserTurn(text: string): void; // agrega msg user + msg assistant vacío
  appendAssistantDelta(text: string): void;
  addToolCall(id: string, name: string, input: unknown): void;
  resolveToolCall(id: string, output: string, isError: boolean): void;
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

  setAgent: (agentId) => set({ agentId }),
  setConnected: (connected) => set({ connected }),
  onReady: (providerId, model) => set({ providerId, model, connected: true }),

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

  finishTurn: () => set({ streaming: false }),

  pushErrorNote: (message) =>
    set((s) => ({
      streaming: false,
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        text: m.text ? `${m.text}\n\n⚠️ ${message}` : `⚠️ ${message}`,
      })),
    })),
}));
