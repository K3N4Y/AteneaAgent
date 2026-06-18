// Entorno saneado para subprocesos (run_command, start_app): sólo variables
// inocuas + PWD. Un único lugar para esta lista relevante a seguridad, así no
// se filtra el entorno entero (incluidas las npm_*/pnpm_* envenenadas de esta
// máquina) a los comandos que corre el agente.

const SAFE_ENV_VARS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "USER",
  "SHELL",
  "TMPDIR",
  "NODE_ENV",
  "CI",
  "LANGUAGE",
  "TERM",
];

export function subprocessEnv(cwd: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      SAFE_ENV_VARS.filter((k) => k in process.env).map((k) => [k, process.env[k]!]),
    ),
    PWD: cwd,
  };
}
