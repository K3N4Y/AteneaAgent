// Credenciales POR PROVEEDOR. Cada proveedor lee su propia API key de una
// variable de entorno. Nunca se hardcodean ni se mandan a la UI.

/** Nombre de la env var de la key para cada proveedor. */
const API_KEY_ENV: Record<string, string> = {
  opencode: "OPENCODE_ZEN_API_KEY",
  // openai: "OPENAI_API_KEY",
  // anthropic: "ANTHROPIC_API_KEY",
};

export function apiKeyEnvFor(providerId: string): string | undefined {
  return API_KEY_ENV[providerId];
}

export function getApiKey(providerId: string): string | undefined {
  const env = API_KEY_ENV[providerId];
  if (!env) return undefined;
  const value = process.env[env];
  return value && value.trim() ? value : undefined;
}

export function hasApiKey(providerId: string): boolean {
  return getApiKey(providerId) !== undefined;
}

/** Mensaje claro para la UI cuando falta la credencial de un proveedor. */
export function missingKeyMessage(providerId: string): string {
  const env = API_KEY_ENV[providerId] ?? `${providerId.toUpperCase()}_API_KEY`;
  return (
    `Falta la API key del proveedor "${providerId}". ` +
    `Definí la variable de entorno ${env} antes de lanzar la app ` +
    `(para OpenCode Zen, obtené la key en https://opencode.ai/auth).`
  );
}
