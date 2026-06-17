// Espejo del contrato de eventos del motor (sidecar/engine/events.ts).
//
// IMPORTANTE: mantener SINCRONIZADO con el backend. A futuro vivirá en un
// paquete `shared/` importado por ambos lados (ver docs/pendiente.md).

export type AgentId = "plan" | "build" | "e2e";

// Eventos que llegan DEL motor.
export type IncomingEvent =
  | { type: "ready"; providerId: string; model: string }
  | { type: "config_ok"; providerId: string; model: string }
  | { type: "assistant_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean }
  | { type: "permission_request"; id: string; command: string; cwd?: string }
  | { type: "plan"; markdown: string }
  | { type: "done"; usage?: unknown }
  | { type: "error"; message: string };

// Mensajes que la UI envía AL motor.
export type OutgoingMessage =
  | { type: "user_message"; text: string; agentId: AgentId; projectPath?: string }
  | { type: "abort" }
  | { type: "set_config"; providerId: string; model: string; apiKey?: string }
  | { type: "permission_response"; id: string; approved: boolean };
