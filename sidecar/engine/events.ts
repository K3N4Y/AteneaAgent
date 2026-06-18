// Contrato de eventos entre el motor (sidecar) y la UI.
//
// IMPORTANTE: estos tipos deben mantenerse SINCRONIZADOS con su espejo en la
// UI (`src/transport/protocol.ts`). A futuro vivirán en un paquete `shared/`
// importado por ambos lados (ver docs/pendiente.md → Notas de mantenimiento).

import type { LlmMessage } from "../providers/types";

/** Los tres perfiles de agente. En Fase 0 sólo se usa de forma efectiva uno. */
export type AgentId = "plan" | "build" | "e2e";

/** Entrada de un directorio (para el árbol de archivos de la UI). */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

// ── Mensajes que la UI envía al motor ───────────────────────────────────────

export interface UserMessage {
  type: "user_message";
  text: string;
  agentId: AgentId;
  /** Carpeta del proyecto activo. Si se omite, el motor usa su CWD. */
  projectPath?: string;
}

/** Pide abortar el turno en curso. */
export interface AbortMessage {
  type: "abort";
}

/**
 * Reconfigura proveedor/modelo/key al vuelo (botón ⚙ en la UI). La key es
 * opcional: si se omite o llega vacía, se borra el override y se vuelve a la
 * env var. El sidecar responde con `config_ok` (o `error` si el proveedor no
 * existe).
 */
export interface SetConfigMessage {
  type: "set_config";
  providerId: string;
  model: string;
  apiKey?: string;
}

/**
 * Respuesta del usuario a un `permission_request`: aprueba o rechaza la acción
 * solicitada. El `id` enlaza con el request emitido por el motor.
 */
export interface PermissionResponseMessage {
  type: "permission_response";
  id: string;
  approved: boolean;
}

/** Pide listar un directorio del proyecto para el árbol de archivos (no pasa por
 * el LLM). El `reqId` enlaza la respuesta `dir_listing`. */
export interface ListDirMessage {
  type: "list_dir";
  reqId: string;
  path: string;
  projectPath?: string;
}

/** Reemplaza el historial de la sesión para retomar una conversación guardada
 * (o vaciarlo con []). El próximo `user_message` continúa con este contexto. */
export interface LoadHistoryMessage {
  type: "load_history";
  messages: LlmMessage[];
  projectPath?: string;
}

export type IncomingMessage =
  | UserMessage
  | AbortMessage
  | SetConfigMessage
  | PermissionResponseMessage
  | ListDirMessage
  | LoadHistoryMessage;

// ── Eventos que el motor emite a la UI (streaming) ──────────────────────────

export type EngineEvent =
  | { type: "ready"; providerId: string; model: string; cwd: string }
  | { type: "config_ok"; providerId: string; model: string }
  | { type: "assistant_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean }
  | { type: "permission_request"; id: string; command: string; cwd?: string }
  | { type: "dir_listing"; reqId: string; path: string; entries: DirEntry[]; error?: string }
  | { type: "plan"; markdown: string }
  | { type: "done"; usage?: unknown }
  | { type: "error"; message: string };

export type EmitFn = (event: EngineEvent) => void;
