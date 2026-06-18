// Credenciales POR PROVEEDOR. Cada proveedor lee su propia API key de una
// variable de entorno. Nunca se hardcodean ni se mandan a la UI.
//
// Hay dos fuentes, en orden de precedencia:
//   1. Override en memoria, seteado por el mensaje WS "set_config" desde la UI
//      (botón ⚙ → modal). Permite reconfigurar al vuelo sin reiniciar el sidecar.
//   2. Variable de entorno. Útil para correr headless o en CI.

/** Nombre de la env var de la key para cada proveedor. */
const API_KEY_ENV: Record<string, string> = {
  opencode: "OPENCODE_ZEN_API_KEY",
  "opencode-go": "OPENCODE_GO_API_KEY",
  // openai: "OPENAI_API_KEY",
  // anthropic: "ANTHROPIC_API_KEY",
};

// ponytail: override map en memoria. Pierde el contenido al reiniciar el sidecar;
// la UI lo reenvía en cada reconexión desde localStorage.
const KEY_OVERRIDES = new Map<string, string>();

export function apiKeyEnvFor(providerId: string): string | undefined {
  return API_KEY_ENV[providerId];
}

export function getApiKey(providerId: string): string | undefined {
  const override = KEY_OVERRIDES.get(providerId);
  if (override) return override;
  const env = API_KEY_ENV[providerId];
  if (!env) return undefined;
  const value = process.env[env];
  return value && value.trim() ? value : undefined;
}

export function hasApiKey(providerId: string): boolean {
  return getApiKey(providerId) !== undefined;
}

/** Setea o limpia el override en memoria para un proveedor. */
export function setApiKeyOverride(
  providerId: string,
  key: string | undefined,
): void {
  if (key && key.trim()) {
    KEY_OVERRIDES.set(providerId, key.trim());
  } else {
    KEY_OVERRIDES.delete(providerId);
  }
}

/** Mensaje claro para la UI cuando falta la credencial de un proveedor. */
export function missingKeyMessage(providerId: string): string {
  const env = API_KEY_ENV[providerId] ?? `${providerId.toUpperCase()}_API_KEY`;
  return (
    `Falta la API key del proveedor "${providerId}". ` +
    `Definí la variable de entorno ${env} o configurala desde el botón ⚙. ` +
    `(para OpenCode Zen/Go, obtené la key en https://opencode.ai/auth).`
  );
}
