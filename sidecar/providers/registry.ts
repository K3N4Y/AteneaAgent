// Registro/fábrica de proveedores. Agregar uno nuevo = registrarlo con una
// línea (ver registerBuiltinProviders más abajo).

import type { LlmProvider } from "./types";
import { OpenAICompatibleProvider } from "./openai-compatible";

const registry = new Map<string, LlmProvider>();

export function registerProvider(p: LlmProvider): void {
  registry.set(p.id, p);
}

export function getProvider(id: string): LlmProvider {
  const p = registry.get(id);
  if (!p) throw new Error(`Proveedor desconocido: ${id}`);
  return p;
}

export function listProviderIds(): string[] {
  return [...registry.keys()];
}

/**
 * Registra los proveedores disponibles al arrancar el sidecar.
 *
 * Hoy: sólo OpenCode Zen (OpenAI-compatible). Para agregar OpenAI "real" u otro
 * gateway compatible basta una línea más con otra baseURL/env de la key.
 */
export function registerBuiltinProviders(): void {
  registerProvider(
    new OpenAICompatibleProvider({
      id: "opencode",
      baseURL: "https://opencode.ai/zen/v1",
      apiKeyEnv: "OPENCODE_ZEN_API_KEY",
      // Fallback del catálogo de modelos si GET /models no responde.
      modelsFallbackUrl: "https://models.dev/api.json",
      modelsFallbackPath: "opencode",
    }),
  );

  // registerProvider(new OpenAICompatibleProvider({ id: "openai", baseURL: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" }));
  // registerProvider(new AnthropicProvider()); // ← adaptador propio, a futuro
}
