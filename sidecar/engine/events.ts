// Contrato de eventos entre el motor (sidecar) y la UI.
//
// IMPORTANTE: estos tipos deben mantenerse SINCRONIZADOS con su espejo en la
// UI (`src/transport/protocol.ts`). A futuro vivirán en un paquete `shared/`
// importado por ambos lados (ver docs/pendiente.md → Notas de mantenimiento).

/** Los tres perfiles de agente. En Fase 0 sólo se usa de forma efectiva uno. */
export type AgentId = "plan" | "build" | "e2e";

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

export type IncomingMessage = UserMessage | AbortMessage;

// ── Eventos que el motor emite a la UI (streaming) ──────────────────────────

export type EngineEvent =
  | { type: "ready"; providerId: string; model: string }
  | { type: "assistant_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean }
  | { type: "plan"; markdown: string }
  | { type: "done"; usage?: unknown }
  | { type: "error"; message: string };

export type EmitFn = (event: EngineEvent) => void;
