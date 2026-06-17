// edit_file: aplica ediciones en formato hashline. Cada sección empieza con la
// cabecera [PATH#TAG] que devolvió read_file y lleva ops por número de línea.
//
// Verificación: antes de tocar nada, el hash actual de CADA archivo debe
// coincidir con su TAG. Si no, error claro pidiendo re-leer (la recuperación
// avanzada basada en snapshots queda para después). Se aplica en dos fases para
// no dejar escrituras parciales si alguna sección falla.

import { z } from "zod";

import { type Tool, type ToolResult } from "./types";
import { readWithinProject, writeWithinProject } from "./fs-safe";
import { computeFileHash, toLines } from "../edit/hashline/hash";
import { formatHeader } from "../edit/hashline/format";
import { parseHashline } from "../edit/hashline/parser";
import { applyOps, diffPreview } from "../edit/hashline/apply";

const schema = z.object({
  input: z
    .string()
    .describe(
      "Ediciones hashline. Cada sección: cabecera [PATH#TAG] (la de read_file) " +
        "seguida de ops SWAP/DEL/INS.PRE/INS.POST/INS.HEAD/INS.TAIL. Las filas de " +
        "cuerpo empiezan con '+'.",
    ),
});

interface Planned {
  path: string;
  before: string[];
  after: string[];
  newHash: string;
}

export const editFileTool: Tool<z.infer<typeof schema>> = {
  name: "edit_file",
  description:
    "Modifica archivos EXISTENTES con ediciones hashline ancladas a número de " +
    "línea + hash. Copiá la cabecera [PATH#TAG] tal como te la dio read_file. Si " +
    "el archivo cambió desde la lectura, falla y te pide re-leer. Para crear un " +
    "archivo nuevo usá write_file.",
  schema,
  async run({ input }, ctx): Promise<ToolResult> {
    let sections;
    try {
      sections = parseHashline(input);
    } catch (err) {
      return { output: `Error de formato hashline: ${(err as Error).message}`, isError: true };
    }

    // Fase 1: validar hashes y calcular el resultado de cada sección.
    const planned: Planned[] = [];
    for (const sec of sections) {
      let current: string;
      try {
        current = await readWithinProject(sec.path, ctx);
      } catch (err) {
        return {
          output:
            `No se pudo leer ${sec.path} para editar: ${(err as Error).message}. ` +
            `Si el archivo no existe, usá write_file para crearlo.`,
          isError: true,
        };
      }

      const currentHash = computeFileHash(current);
      if (currentHash !== sec.tag) {
        return { output: mismatchMessage(sec.path, sec.tag, current, currentHash), isError: true };
      }

      const before = toLines(current);
      let after: string[];
      try {
        after = applyOps(before, sec.ops);
      } catch (err) {
        return { output: `Error aplicando ops en ${sec.path}: ${(err as Error).message}`, isError: true };
      }
      planned.push({ path: sec.path, before, after, newHash: computeFileHash(after.join("\n")) });
    }

    // Fase 2: escribir todo (ya validado) y armar la salida.
    const results: string[] = [];
    for (const p of planned) {
      try {
        await writeWithinProject(p.path, p.after.join("\n"), ctx);
      } catch (err) {
        return { output: `No se pudo escribir ${p.path}: ${(err as Error).message}`, isError: true };
      }
      ctx.snapshots.record(p.path, p.after, p.newHash);
      results.push(`${formatHeader(p.path, p.newHash)}\n${diffPreview(p.before, p.after)}`);
    }

    return { output: results.join("\n\n"), isError: false };
  },
};

function mismatchMessage(
  path: string,
  expected: string,
  current: string,
  currentHash: string,
): string {
  const preview = toLines(current)
    .slice(0, 8)
    .map((l, i) => `${i + 1}:${l}`)
    .join("\n");
  return (
    `El archivo ${path} cambió desde que lo leíste ` +
    `(esperaba #${expected}, ahora es #${currentHash}). ` +
    `Volvé a leerlo con read_file y rehacé el edit con la cabecera nueva.\n` +
    `Inicio actual del archivo:\n${formatHeader(path, currentHash)}\n${preview}`
  );
}
