// start_app: arranca la app construida como proceso de FONDO de larga duración
// (un servidor de dev, p. ej. `npm run dev`) SIN bloquear el loop. run_command
// no sirve para esto: bloquea hasta que el proceso termina o vence el timeout,
// y un servidor de dev no termina nunca. start_app spawnea, espera a que arranque
// (una cadena "ready" o un grace period), devuelve estado + primeros logs y deja
// el proceso vivo. El server lo registra (ctx.trackProcess) para matarlo al
// cerrar la sesión y no dejar servidores huérfanos.
//
// `detached: true` hace que el shell quede como líder de un nuevo process group
// (POSIX) / job tree (Windows), para que killProcessTree mate a toda la cadena
// `npm` → `node` → `vite` de un solo kill y no queden nietos huérfanos.

import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";

import { type Tool, type ToolResult } from "./types";
import { resolveWithinProject } from "./fs-safe";
import { subprocessEnv } from "./proc-env";
import { MAX_COMMAND_OUTPUT_BYTES } from "../config/limits";

export function killProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ya muerto */
    }
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ya muerto */
      }
    });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ya muerto */
      }
    }
  }
}

const DEFAULT_WAIT_MS = 4000;
const MAX_WAIT_MS = 30_000;

const schema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      "Comando que arranca la app, p. ej. 'npm run dev'. Debe ser un proceso de larga duración.",
    ),
  cwd: z
    .string()
    .optional()
    .describe(
      'Directorio de trabajo, relativo a la raíz del proyecto. Por defecto "." (la raíz).',
    ),
  ready: z
    .string()
    .optional()
    .describe(
      "Subcadena que, al aparecer en la salida, indica que la app ya arrancó (p. ej. 'Local:' o 'listening'). Si se omite, se espera wait_ms.",
    ),
  wait_ms: z
    .number()
    .int()
    .positive()
    .max(MAX_WAIT_MS)
    .optional()
    .describe(
      `Cuánto esperar a que arranque antes de reportar el estado (default ${DEFAULT_WAIT_MS} ms).`,
    ),
});

export const startAppTool: Tool<z.infer<typeof schema>> = {
  name: "start_app",
  description:
    "Arranca la app construida como proceso de FONDO de larga duración (servidor de dev, etc.) y " +
    "devuelve su estado inicial y primeros logs SIN bloquear; el proceso queda vivo hasta que se " +
    "cierra la sesión. Para comandos que terminan (tests, build, install) usá run_command, no esto. " +
    "Pide confirmación al usuario antes de arrancar.",
  schema,
  async run({ command, cwd, ready, wait_ms }, ctx): Promise<ToolResult> {
    let cwdAbs: string;
    try {
      cwdAbs = resolveWithinProject(cwd && cwd.trim() ? cwd : ".", ctx);
    } catch (err) {
      return {
        output: `cwd inválido: ${(err as Error).message}`,
        isError: true,
      };
    }

    // Mismo gate de confirmación que run_command: arrancar un proceso es una
    // acción difícil de revertir. Sin ctx.confirm ⇒ denegado por seguridad.
    const approved = ctx.confirm ? await ctx.confirm({ command, cwd }) : false;
    if (!approved)
      return { output: "El usuario rechazó arrancar la app.", isError: true };

    return spawnApp(
      command,
      cwdAbs,
      ready,
      wait_ms ?? DEFAULT_WAIT_MS,
      ctx.trackProcess,
    );
  },
};

function spawnApp(
  command: string,
  cwd: string,
  ready: string | undefined,
  waitMs: number,
  track: ((child: ReturnType<typeof spawn>) => void) | undefined,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: subprocessEnv(cwd),
      detached: true,
    });
    track?.(child); // que el server pueda matarlo al cerrar la sesión

    const chunks: Buffer[] = [];
    let remaining = MAX_COMMAND_OUTPUT_BYTES;
    let settled = false;
    let exited: number | null = null;

    const logs = () =>
      chunks.length
        ? Buffer.concat(chunks).toString("utf8")
        : "(sin salida todavía)";

    const finish = (readyHit: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exited !== null) {
        // Terminó solo: no es una app de larga duración (o crasheó al arrancar).
        resolve({
          output: `$ ${command}\n[el proceso terminó con exit ${exited} — no quedó corriendo]\n${logs()}`,
          isError: true,
        });
      } else {
        const note = readyHit
          ? `lista (apareció "${ready}")`
          : `corriendo tras ${waitMs} ms`;
        resolve({
          output: `$ ${command}\n[app ${note}; pid ${child.pid}, sigue viva en segundo plano]\n${logs()}`,
          isError: false,
        });
      }
    };

    const collect = (buf: Buffer) => {
      if (remaining > 0) {
        const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
        chunks.push(slice);
        remaining -= slice.length;
      }
      if (
        ready &&
        !settled &&
        Buffer.concat(chunks).toString("utf8").includes(ready)
      ) {
        finish(true);
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output: `No se pudo arrancar: ${err.message}`, isError: true });
    });
    child.on("exit", (code) => {
      exited = code ?? 0;
      finish(false);
    });

    const timer = setTimeout(() => finish(false), waitMs);
  });
}
