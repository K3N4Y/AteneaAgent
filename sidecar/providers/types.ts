// Tipos normalizados, agnósticos del proveedor. El motor (engine/loop.ts) sólo
// habla en estos tipos; cada adaptador traduce hacia/desde el formato de su SDK.

export interface ModelInfo {
  /** id del modelo a pasar en LlmRequest.model */
  id: string;
  /** nombre legible para la UI (opcional) */
  label?: string;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; output: string; isError?: boolean };

export type LlmMessage =
  | { role: "user"; content: ContentPart[] }
  | { role: "assistant"; content: ContentPart[] };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema derivado del esquema Zod de la tool. */
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  system?: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  /** Capacidad estilo Claude; los adaptadores que no la soporten la ignoran. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Capacidad estilo Claude; ignorada por adaptadores no-Anthropic. */
  thinking?: boolean;
}

export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "done"; stopReason: string; usage?: unknown }
  | { type: "error"; message: string };

export interface LlmProvider {
  id: string;
  stream(req: LlmRequest, signal?: AbortSignal): AsyncIterable<LlmStreamEvent>;
  /** Opcional: para poblar el selector de modelos de la UI. */
  listModels?(): Promise<ModelInfo[]>;
  /**
   * Opcional: reconfigura la credencial en caliente (mensaje "set_config" desde
   * la UI). La próxima llamada a stream/listModels usa la nueva key. Si los
   * adaptadores la cachean, deben invalidar el cache acá.
   */
  setApiKey?(key: string | undefined): void;
}
