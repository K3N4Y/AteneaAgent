// Smoke test determinista del flujo de configuración runtime (sin LLM).
// Verifica que: (1) el override en memoria pisa la env var, (2) setApiKey
// del provider reconfigura hasKey, y (3) limpiar el override vuelve a la env var.
//
// Correr:  pnpm --dir sidecar exec tsx smoke-config.ts

import { getApiKey, hasApiKey, setApiKeyOverride } from "./config/secrets";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

const ENV_NAME = "OPENCODE_ZEN_API_KEY";
const originalEnv = process.env[ENV_NAME];
process.env[ENV_NAME] = "env-key-value";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function main() {
  console.log("secrets:");
  check("env var: getApiKey devuelve el valor de la env", getApiKey("opencode") === "env-key-value");
  check("env var: hasApiKey es true", hasApiKey("opencode"));

  setApiKeyOverride("opencode", "override-key-value");
  check("override: pisa la env var", getApiKey("opencode") === "override-key-value");
  check("override: hasApiKey sigue true", hasApiKey("opencode"));

  setApiKeyOverride("opencode", "");
  check("override vacío: vuelve a la env var", getApiKey("opencode") === "env-key-value");

  setApiKeyOverride("opencode", "  spaced-key  ");
  check("override con whitespace se trimea", getApiKey("opencode") === "spaced-key");

  check("providerId desconocido: getApiKey undefined", getApiKey("nope-123") === undefined);
  check("providerId desconocido: hasApiKey false", !hasApiKey("nope-123"));

  console.log("\nprovider:");
  const p1 = new OpenAICompatibleProvider({
    id: "opencode",
    baseURL: "https://example.invalid/v1",
    apiKeyEnv: ENV_NAME,
  });
  check("constructor no tira con env var", Boolean(p1));

  p1.setApiKey("new-runtime-key");
  // setApiKey ya actualiza el override internamente, pero por las dudas:
  check("tras setApiKey(key), getApiKey refleja la nueva key", getApiKey("opencode") === "new-runtime-key");

  p1.setApiKey(undefined);
  check("setApiKey(undefined) vuelve a la env var", getApiKey("opencode") === "env-key-value");

  const p2 = new OpenAICompatibleProvider({
    id: "noenv",
    baseURL: "https://example.invalid/v1",
    apiKeyEnv: "NOENV_THIS_DOES_NOT_EXIST",
  });
  // Sin key, listModels va directo al fallback (no pega a /models). Sin
  // modelsFallbackUrl configurado, devuelve []. La señal esperada: array.
  const models = await p2.listModels();
  check("provider sin key: listModels devuelve [] (fallback)", Array.isArray(models) && models.length === 0);
}

main()
  .then(() => {
    if (originalEnv === undefined) delete process.env[ENV_NAME];
    else process.env[ENV_NAME] = originalEnv;
    setApiKeyOverride("opencode", undefined);
    console.log(failures === 0 ? "\nTODO OK ✓" : `\n${failures} FALLO(S) ✗`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
