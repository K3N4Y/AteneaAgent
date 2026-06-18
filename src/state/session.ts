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
  /**
   * Cuánto texto del asistente existía al invocarse la tool (= m.text.length en
   * ese instante). Es el ancla cronológica: el render intercala la tarjeta justo
   * en ese punto del texto, así queda donde se usó y no apilada al final.
   * Ausente en sesiones viejas persistidas → se trata como "al final" (legacy).
   */
  textOffset?: number;
  /**
   * Sólo para la tool `task`: el sub-transcript EN VIVO de cada subagente,
   * indexado por su posición en `tasks`. En vez de tratar al subagente como caja
   * negra (sólo un contador), guardamos sus propias tool-calls anidadas para
   * renderizarlas indentadas bajo la tarjeta del `task` — como en Claude Code.
   * Los eventos anidados llegan con `parentToolId` = índice del subagente.
   * Ausente en el resto de las tools (y en sesiones viejas persistidas).
   */
  subagents?: SubagentRun[];
}

/**
 * Corrida de un subagente lanzado por la tool `task`: su tipo (`explore`/`build`,
 * para etiquetar) y las tool-calls que fue haciendo. El render las muestra
 * indentadas y en vivo bajo la tarjeta del `task`. El resumen final (texto que
 * devolvió) sigue llegando como el `output` del propio `task`.
 */
export interface SubagentRun {
  type?: string;
  toolCalls: UiToolCall[];
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

/**
 * Un tramo de razonamiento del modelo. El agente piensa, usa una tool, vuelve a
 * pensar… cada ráfaga es un tramo distinto. `afterTools` es el ancla cronológica:
 * cuántas tools existían cuando arrancó este tramo, así el render lo intercala
 * justo después de esa tool (igual que `textOffset` ancla las tarjetas al texto).
 */
export interface ThinkingSegment {
  text: string;
  afterTools: number;
}

export type Message =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      toolCalls: UiToolCall[];
      plan?: UiPlan;
      // string = formato viejo persistido (un solo bloque); array = tramos nuevos.
      thinking?: ThinkingSegment[] | string;
    };

/** Normaliza `thinking` a tramos. Tolera el string legacy de sesiones viejas. */
export function thinkingSegments(
  thinking: ThinkingSegment[] | string | undefined,
): ThinkingSegment[] {
  if (!thinking) return [];
  if (typeof thinking === "string") return [{ text: thinking, afterTools: 0 }];
  return thinking;
}

/** Subagentes iniciales de un `task`: uno por sub-tarea (con su tipo, sin tools
 * todavía), para que la tarjeta liste todos los subagentes desde el arranque. */
function subagentsInit(input: unknown): SubagentRun[] | undefined {
  const tasks = (input as { tasks?: { subagent_type?: string }[] })?.tasks;
  return Array.isArray(tasks)
    ? tasks.map((t) => ({ type: t.subagent_type, toolCalls: [] }))
    : undefined;
}

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
  /** Tool-call anidada de un subagente del `task` en curso (índice = posición en
   * `tasks`). Alimenta el sub-transcript en vivo de la tarjeta. */
  addSubToolCall(index: number, id: string, name: string, input: unknown): void;
  resolveSubToolCall(
    index: number,
    id: string,
    output: string,
    isError: boolean,
  ): void;
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
  fn: (
    m: Extract<Message, { role: "assistant" }>,
  ) => Extract<Message, { role: "assistant" }>,
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

/**
 * Aplica `fn` al subagente `index` del `task` EN CURSO (la última tool-call
 * `task` sin terminar) de forma inmutable. Si no hay un `task` activo, no toca
 * nada. Crece el array de subagentes si hiciera falta (defensivo ante eventos
 * que lleguen antes del init). Centraliza la lógica que comparten las acciones
 * `addSubToolCall`/`resolveSubToolCall`.
 */
function updateActiveSubagent(
  m: Extract<Message, { role: "assistant" }>,
  index: number,
  fn: (run: SubagentRun) => SubagentRun,
): Extract<Message, { role: "assistant" }> {
  let idx = -1;
  for (let i = m.toolCalls.length - 1; i >= 0; i--) {
    if (m.toolCalls[i].name === "task" && !m.toolCalls[i].done) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return m;
  const calls = m.toolCalls.slice();
  const subagents = (calls[idx].subagents ?? []).slice();
  while (subagents.length <= index) subagents.push({ toolCalls: [] });
  subagents[index] = fn(subagents[index]);
  calls[idx] = { ...calls[idx], subagents };
  return { ...m, toolCalls: calls };
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
    set({
      messages: [],
      sessionId: crypto.randomUUID(),
      streaming: false,
      pendingPermission: undefined,
    }),

  loadSession: (s) =>
    set((prev) => {
      // Al retomar una sesión, su proyecto pasa a ser el proyecto de trabajo y
      // se persiste (sobrevive al reinicio), igual que un setProjectPath manual.
      if (s.projectPath) localStorage.setItem(PROJECT_KEY, s.projectPath);
      return {
        messages: s.messages,
        agentId: s.agentId,
        projectPath: s.projectPath ?? prev.projectPath,
        sessionId: s.id,
        streaming: false,
        pendingPermission: undefined,
      };
    }),

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
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        text: m.text + text,
      })),
    })),

  appendThinkingDelta: (text) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => {
        const segs = thinkingSegments(m.thinking);
        const last = segs[segs.length - 1];
        // Tramo nuevo si no hay ninguno, o si entró una tool desde que empezó el
        // último: ese corte es el que separa "pensar → usar tool → volver a pensar".
        if (!last || last.afterTools !== m.toolCalls.length) {
          return {
            ...m,
            thinking: [...segs, { text, afterTools: m.toolCalls.length }],
          };
        }
        const merged = segs
          .slice(0, -1)
          .concat({ ...last, text: last.text + text });
        return { ...m, thinking: merged };
      }),
    })),

  addToolCall: (id, name, input) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        // textOffset ancla la tarjeta al punto actual del texto (orden cronológico).
        // task: arranca con un subagente vacío por sub-tarea (ver subagents).
        toolCalls: [
          ...m.toolCalls,
          {
            id,
            name,
            input,
            done: false,
            textOffset: m.text.length,
            ...(name === "task" ? { subagents: subagentsInit(input) } : {}),
          },
        ],
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

  addSubToolCall: (index, id, name, input) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) =>
        updateActiveSubagent(m, index, (run) => ({
          ...run,
          toolCalls: [...run.toolCalls, { id, name, input, done: false }],
        })),
      ),
    })),

  resolveSubToolCall: (index, id, output, isError) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) =>
        updateActiveSubagent(m, index, (run) => ({
          ...run,
          toolCalls: run.toolCalls.map((t) =>
            t.id === id ? { ...t, output, isError, done: true } : t,
          ),
        })),
      ),
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
