// read_file: lee un archivo de texto del proyecto y lo devuelve numerado con un
// hash de archivo (formato hashline). Graba un snapshot para que edit_file pueda
// verificar/recuperar después.

import { z } from "zod";

import { type Tool, type ToolResult } from "./types";
import { readWithinProject } from "./fs-safe";
import { computeFileHash, toLines } from "../edit/hashline/hash";
import {
  formatHeader,
  parseRanges,
  buildNumbered,
} from "../edit/hashline/format";

const schema = z.object({
  path: z
    .string()
    .describe("Ruta del archivo, relativa a la raíz del proyecto."),
  range: z
    .string()
    .optional()
    .describe('Rango opcional: "41-80", "10+5", "42", "100-", "5-16,200-210".'),
});

export const readFileTool: Tool<z.infer<typeof schema>> = {
  name: "read_file",
  description:
    "Lee un archivo de texto del proyecto y lo devuelve numerado con un hash de " +
    "archivo. Copia la cabecera [PATH#TAG] y los números de línea tal cual para " +
    "construir un edit_file. Acepta un rango opcional para leer sólo una parte.",
  schema,
  async run({ path, range }, ctx): Promise<ToolResult> {
    let text: string;
    try {
      text = await readWithinProject(path, ctx);
    } catch (err) {
      return {
        output: `No se pudo leer ${path}: ${(err as Error).message}`,
        isError: true,
      };
    }

    const lines = toLines(text);
    const hash = computeFileHash(text);
    // El snapshot guarda SIEMPRE el archivo completo (aunque se lea un rango).
    ctx.snapshots.record(path, lines, hash);

    const ranges = parseRanges(range, lines.length);
    const body = buildNumbered(lines, ranges);
    return { output: `${formatHeader(path, hash)}\n${body}`, isError: false };
  },
};
