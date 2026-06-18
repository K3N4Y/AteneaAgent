// Adaptador genérico para cualquier endpoint **compatible con OpenAI**.
// Hoy lo instanciamos para OpenCode Zen; mañana, OpenAI "real" u otro gateway
// es el MISMO adaptador con otra baseURL/key (ver providers/registry.ts).

import OpenAI from "openai";
import { randomUUID } from "node:crypto";

import type {
  LlmProvider,
  LlmRequest,
  LlmStreamEvent,
  LlmMessage,
  ModelInfo,
  ToolSpec,
} from "./types";
import { getApiKey, setApiKeyOverride } from "../config/secrets";

export interface OpenAICompatibleConfig {
  id: string;
  baseURL: string;
  apiKeyEnv: string;
  /** URL de catálogo de modelos a usar si GET /models no responde. */
  modelsFallbackUrl?: string;
  /** Clave del proveedor dentro del JSON de fallback (p. ej. "opencode"). */
  modelsFallbackPath?: string;
}

// Marcador para no romper el constructor del SDK cuando falta la key. La
// llamada real fallará con 401 y el motor avisa antes con un mensaje claro.
const NO_KEY_PLACEHOLDER = "MYAGENT_NO_KEY";

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id: string;
  private client: OpenAI;
  private readonly cfg: OpenAICompatibleConfig;
  private hasKey: boolean;

  constructor(cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.cfg = cfg;
    // Lee del módulo de secrets (override en memoria > env var) para que
    // reconfigurar al vuelo desde la UI no requiera reiniciar el sidecar.
    const key = getApiKey(cfg.id);
    this.hasKey = Boolean(key);
    this.client = new OpenAI({
      baseURL: cfg.baseURL,
      apiKey: key || NO_KEY_PLACEHOLDER,
    });
  }

  /** Reconfigura la credencial; la próxima llamada usa la nueva key. */
  setApiKey(key: string | undefined): void {
    setApiKeyOverride(this.id, key);
    const effective = getApiKey(this.id);
    this.hasKey = Boolean(effective);
    this.client = new OpenAI({
      baseURL: this.cfg.baseURL,
      apiKey: effective || NO_KEY_PLACEHOLDER,
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    // Sin key real no tiene sentido pegarle a /models con el placeholder y
    // depender de un 401 "limpio" (otro gateway podría colgar o devolver basura):
    // vamos directo al catálogo público de fallback.
    if (!this.hasKey) return this.listModelsFallback();
    try {
      const res = await this.client.models.list();
      const data = res.data ?? [];
      if (data.length > 0) return data.map((m) => ({ id: m.id }));
      throw new Error("GET /models devolvió una lista vacía");
    } catch {
      return this.listModelsFallback();
    }
  }

  private async listModelsFallback(): Promise<ModelInfo[]> {
    const { modelsFallbackUrl, modelsFallbackPath } = this.cfg;
    if (!modelsFallbackUrl || !modelsFallbackPath) return [];
    try {
      const res = await fetch(modelsFallbackUrl);
      const json: any = await res.json();
      const models = json?.[modelsFallbackPath]?.models ?? {};
      return Object.keys(models).map((id) => ({ id, label: models[id]?.name }));
    } catch {
      return [];
    }
  }

  async *stream(
    req: LlmRequest,
    signal?: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    // Defensa en profundidad: el server ya filtra por hasApiKey antes de llegar
    // acá, pero si falta la key cortamos en seco con un mensaje claro en vez de
    // mandar el placeholder y depender de que el server devuelva un 401 limpio.
    if (!this.hasKey) {
      yield {
        type: "error",
        message: `Falta la API key del proveedor "${this.id}" (definí ${this.cfg.apiKeyEnv}).`,
      };
      return;
    }

    // Acumulador de tool_calls: en streaming los `arguments` llegan en TROZOS y
    // hay que concatenarlos antes de JSON.parse.
    const acc = new Map<number, { id?: string; name?: string; args: string }>();
    let finishReason = "stop";
    let usage: unknown;

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: req.model,
          messages: toOpenAIMessages(req.system, req.messages),
          tools: req.tools?.map(toOpenAITool),
          stream: true,
          ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
          // `effort`/`thinking` son capacidades estilo Claude: este adaptador
          // las ignora a propósito (algunos modelos dan 400 con reasoning_effort).
        },
        { signal },
      );

      for await (const chunk of stream) {
        // El chunk terminal de usage de OpenAI llega con choices:[]; por eso
        // capturamos usage ANTES del guard de choice (moverlo abajo lo perdería).
        // El `done` se emite recién al drenar el stream (después de este for),
        // así que nunca sale "antes de tiempo" por un chunk de usage suelto.
        if (chunk.usage) usage = chunk.usage;

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          yield { type: "text_delta", text: delta.content };
        }
        // Razonamiento: no está en el tipo de OpenAI; los gateways lo exponen
        // como `reasoning_content` (DeepSeek) o `reasoning` (OpenRouter).
        const reasoning =
          (delta as any)?.reasoning_content ?? (delta as any)?.reasoning;
        if (reasoning) {
          yield { type: "thinking_delta", text: reasoning };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = acc.get(idx) ?? { args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            acc.set(idx, cur);
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    } catch (err) {
      yield { type: "error", message: errorMessage(err) };
      return;
    }

    // Emitir las tool_calls ya completas, en orden de índice.
    for (const [, c] of [...acc.entries()].sort((a, b) => a[0] - b[0])) {
      let input: unknown = {};
      if (c.args) {
        try {
          input = JSON.parse(c.args);
        } catch {
          yield {
            type: "error",
            message: `Argumentos no-JSON para la tool ${c.name ?? "?"}: ${c.args}`,
          };
          continue;
        }
      }
      yield {
        type: "tool_call",
        id: c.id ?? randomUUID(),
        name: c.name ?? "",
        input,
      };
    }

    yield { type: "done", stopReason: finishReason, usage };
  }
}

// ── Traducción de tipos normalizados → formato OpenAI ───────────────────────

function toOpenAITool(
  spec: ToolSpec,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.inputSchema as Record<string, unknown>,
    },
  };
}

function toOpenAIMessages(
  system: string | undefined,
  messages: LlmMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("");
      const toolUses = m.content.filter((p) => p.type === "tool_use") as Array<{
        id: string;
        name: string;
        input: unknown;
      }>;

      const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: text || null,
      };
      if (toolUses.length > 0) {
        msg.tool_calls = toolUses.map((tu) => ({
          id: tu.id,
          type: "function",
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input ?? {}),
          },
        }));
      }
      out.push(msg);
    } else {
      // role === "user": los tool_result se mandan como mensajes role:"tool"
      // (deben seguir al assistant que pidió las tools); el texto, como "user".
      const toolResults = m.content.filter(
        (p) => p.type === "tool_result",
      ) as Array<{ toolUseId: string; output: string }>;
      for (const tr of toolResults) {
        out.push({
          role: "tool",
          tool_call_id: tr.toolUseId,
          content: tr.output,
        });
      }
      const text = m.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("");
      if (text) out.push({ role: "user", content: text });
    }
  }
  return out;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
