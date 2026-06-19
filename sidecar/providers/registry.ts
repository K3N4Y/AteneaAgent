// Registro/fábrica de proveedores. Agregar uno nuevo = registrarlo con una
// línea (ver registerBuiltinProviders más abajo).

import type { LlmProvider } from "./types";
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from "./openai-compatible";

const registry = new Map<string, LlmProvider>();

function registerProvider(p: LlmProvider): void {
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
 * Gateways OpenAI-compatible que comparten el MISMO adaptador: sólo cambian
 * baseURL y la env var de la key. Agregar otro = una entrada más en esta tabla.
 * (OpenAI "real" entraría acá; un proveedor con protocolo propio —Anthropic—
 * necesita su propio adaptador y se registra aparte.)
 */
const ZEN_PROVIDERS: OpenAICompatibleConfig[] = [
  // OpenCode Zen: pago por uso.
  {
    id: "opencode",
    baseURL: "https://opencode.ai/zen/v1",
    apiKeyEnv: "OPENCODE_ZEN_API_KEY",
    // Fallback del catálogo de modelos si GET /models no responde.
    modelsFallbackUrl: "https://models.dev/api.json",
    modelsFallbackPath: "opencode",
  },
  // OpenCode Go: plan de suscripción mensual sobre el mismo gateway Zen.
  {
    id: "opencode-go",
    baseURL: "https://opencode.ai/zen/go/v1",
    apiKeyEnv: "OPENCODE_GO_API_KEY",
    modelsFallbackUrl: "https://models.dev/api.json",
    modelsFallbackPath: "opencode",
  },
];

/** Registra los proveedores disponibles al arrancar el sidecar. */
export function registerBuiltinProviders(): void {
  for (const cfg of ZEN_PROVIDERS) {
    registerProvider(new OpenAICompatibleProvider(cfg));
  }

  // registerProvider(new OpenAICompatibleProvider({ id: "openai", baseURL: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" }));
  // registerProvider(new AnthropicProvider()); // ← adaptador propio, a futuro
}
