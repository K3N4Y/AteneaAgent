// write_file: CREA un archivo nuevo (o sobrescribe) con el contenido dado.
// En el modelo hashline, `edit_file` sólo MODIFICA archivos existentes; crear
// desde cero es trabajo de write_file.

import { z } from "zod";

import { type Tool, type ToolResult } from "./types";
import { writeWithinProject, existsWithinProject } from "./fs-safe";
import {
  canonicalSnapshotPath,
  normalizeSnapshotText,
} from "./hashline-filesystem";
import { formatHeader } from "../edit/hashline/format";
import { MAX_FILE_BYTES } from "../config/limits";

const schema = z.object({
  path: z
    .string()
    .describe("Ruta del archivo a crear, relativa a la raíz del proyecto."),
  content: z.string().describe("Contenido completo del archivo."),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      "Permitir sobrescribir si el archivo ya existe (por defecto false).",
    ),
});

export const writeFileTool: Tool<z.infer<typeof schema>> = {
  name: "write_file",
  description:
    "Crea un archivo nuevo con el contenido dado (crea carpetas intermedias). " +
    "Para MODIFICAR un archivo existente usá edit_file, no write_file. Si el " +
    "archivo ya existe, falla salvo que pases overwrite: true.",
  schema,
  async run({ path, content, overwrite }, ctx): Promise<ToolResult> {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      return {
        output: `El contenido de ${path} es demasiado grande (${bytes} bytes; máx ${MAX_FILE_BYTES}).`,
        isError: true,
      };
    }

    try {
      if (!overwrite && (await existsWithinProject(path, ctx))) {
        return {
          output:
            `El archivo ${path} ya existe. Usá edit_file para modificarlo, ` +
            `o write_file con overwrite: true para reemplazarlo.`,
          isError: true,
        };
      }
      await writeWithinProject(path, content, ctx);
    } catch (err) {
      return {
        output: `No se pudo escribir ${path}: ${(err as Error).message}`,
        isError: true,
      };
    }

    const normalized = normalizeSnapshotText(content);
    const lineCount = normalized.split("\n").length;
    const snapshotPath = canonicalSnapshotPath(path, ctx);
    // Dejamos el snapshot grabado para encadenar un edit_file sin re-leer.
    const hash = ctx.snapshots.record(snapshotPath, normalized);
    return {
      output: `${formatHeader(path, hash)}\nArchivo creado (${lineCount} líneas).`,
      isError: false,
    };
  },
};
