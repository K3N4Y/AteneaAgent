// Selección de proveedor + modelo por defecto. Override por env para iterar
// sin tocar código (útil mientras no hay selector en la UI).

export interface ProviderModel {
  providerId: string;
  model: string;
}

/** Proveedor por defecto: OpenCode Zen (OpenAI-compatible). */
export const DEFAULT_PROVIDER_ID = process.env.MYAGENT_PROVIDER || "opencode";

/**
 * Modelo por defecto. IDs de Zen no llevan el prefijo `opencode/` de la CLI.
 * Override con MYAGENT_MODEL (p. ej. "minimax-m2.5-free" para probar gratis).
 */
export const DEFAULT_MODEL = process.env.MYAGENT_MODEL || "gpt-5.5";

export function defaultProviderModel(): ProviderModel {
  return { providerId: DEFAULT_PROVIDER_ID, model: DEFAULT_MODEL };
}
