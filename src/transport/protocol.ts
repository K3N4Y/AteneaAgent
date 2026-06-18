// Espejo del contrato de eventos del motor (sidecar/engine/events.ts).
//
// IMPORTANTE: mantener SINCRONIZADO con el backend. A futuro vivirá en un
// paquete `shared/` importado por ambos lados (ver docs/pendiente.md).

export type AgentId = "plan" | "build" | "e2e";

/** Entrada de un directorio (para el árbol de archivos). */
export interface DirEntry {
  name: string;
  isDir: boolean;
}

// Historial normalizado (espejo de providers/types.ts), usado para retomar una
// sesión: la UI reconstruye estos mensajes desde su transcript y se los manda al
// sidecar con `load_history` para que el próximo turno tenga contexto.
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; output: string; isError?: boolean };

export type LlmMessage =
  | { role: "user"; content: ContentPart[] }
  | { role: "assistant"; content: ContentPart[] };

// Eventos que llegan DEL motor.
export type IncomingEvent =
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

// Mensajes que la UI envía AL motor.
export type OutgoingMessage =
  | { type: "user_message"; text: string; agentId: AgentId; projectPath?: string }
  | { type: "abort" }
  | { type: "set_config"; providerId: string; model: string; apiKey?: string }
  | { type: "permission_response"; id: string; approved: boolean }
  | { type: "list_dir"; reqId: string; path: string; projectPath?: string }
  | { type: "load_history"; messages: LlmMessage[]; projectPath?: string };
