// run_command: ejecuta un comando de shell DENTRO del proyecto, pero sólo
// después de confirmación humana (ctx.confirm). Es la acción más sensible del
// motor, así que el gate es explícito: si no hay forma de pedir confirmación,
// se asume DENEGADO. Captura stdout+stderr, con timeout y tope de salida.

import { z } from "zod";
import { spawn } from "node:child_process";

import { type Tool, type ToolResult } from "./types";
import { resolveWithinProject } from "./fs-safe";
import { subprocessEnv } from "./proc-env";
import { MAX_COMMAND_MS, MAX_COMMAND_OUTPUT_BYTES } from "../config/limits";

const schema = z.object({
  command: z.string().min(1).describe("Comando de shell a ejecutar (se corre con `sh -c`)."),
  cwd: z
    .string()
    .optional()
    .describe('Directorio de trabajo, relativo a la raíz del proyecto. Por defecto "." (la raíz).'),
});

export const runCommandTool: Tool<z.infer<typeof schema>> = {
  name: "run_command",
  description:
    "Ejecuta un comando de shell en el proyecto (p. ej. correr tests o un build). " +
    "SIEMPRE pide confirmación al usuario antes de correr; si la rechaza, no se " +
    "ejecuta. Devuelve stdout+stderr combinados y el código de salida.",
  schema,
  async run({ command, cwd }, ctx): Promise<ToolResult> {
    // Resolver el cwd dentro del proyecto antes de pedir confirmación: si la
    // ruta escapa, fallamos sin molestar al usuario.
    let cwdAbs: string;
    try {
      cwdAbs = resolveWithinProject(cwd && cwd.trim() ? cwd : ".", ctx);
    } catch (err) {
      return { output: `cwd inválido: ${(err as Error).message}`, isError: true };
    }

    // Gate de confirmación humana. Sin ctx.confirm ⇒ denegado por seguridad.
    const approved = ctx.confirm ? await ctx.confirm({ command, cwd }) : false;
    if (!approved) {
      return { output: "El usuario rechazó ejecutar el comando.", isError: true };
    }

    return execShell(command, cwdAbs);
  },
};

function execShell(command: string, cwd: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: subprocessEnv(cwd) });

    const chunks: Buffer[] = [];
    let remaining = MAX_COMMAND_OUTPUT_BYTES;
    let capped = false;
    const collect = (buf: Buffer) => {
      if (capped) return;
      if (buf.length > remaining) {
        chunks.push(buf.subarray(0, remaining));
        capped = true;
      } else {
        chunks.push(buf);
        remaining -= buf.length;
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, MAX_COMMAND_MS);

    const finish = (header: string, isError: boolean) => {
      clearTimeout(timer);
      const out = chunks.length ? Buffer.concat(chunks).toString("utf8") : "(sin salida)";
      const tail = capped ? `\n… (salida truncada a ${MAX_COMMAND_OUTPUT_BYTES} bytes)` : "";
      resolve({ output: `${header}\n${out}${tail}`, isError });
    };

    child.on("error", (err) => {
      finish(`No se pudo ejecutar: ${err.message}`, true);
    });
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL") {
        finish(`$ ${command}\n[timeout tras ${MAX_COMMAND_MS} ms; proceso terminado]`, true);
      } else {
        finish(`$ ${command}\n[exit ${code ?? "?"}]`, code !== 0);
      }
    });
  });
}
