// list_dir: lista las entradas de un directorio del proyecto (un solo nivel).
// Marca los directorios con "/" final y ordena: primero carpetas, luego archivos.
// Es read-only, así que está disponible incluso para el agente Plan.

import { z } from "zod";

import { type Tool, type ToolResult } from "./types";
import { readdirWithinProject } from "./fs-safe";
import { MAX_LIST_ENTRIES } from "../config/limits";

const schema = z.object({
  path: z
    .string()
    .optional()
    .describe('Directorio a listar, relativo a la raíz del proyecto. Por defecto "." (la raíz).'),
});

export const listDirTool: Tool<z.infer<typeof schema>> = {
  name: "list_dir",
  description:
    "Lista el contenido de un directorio del proyecto (un nivel). Los " +
    'directorios se marcan con "/" al final. Útil para orientarte antes de ' +
    "leer o buscar. No es recursivo: para explorar más hondo, volvé a llamar.",
  schema,
  async run({ path }, ctx): Promise<ToolResult> {
    const dir = path && path.trim() ? path : ".";
    let entries;
    try {
      entries = await readdirWithinProject(dir, ctx);
    } catch (err) {
      return { output: `No se pudo listar ${dir}: ${(err as Error).message}`, isError: true };
    }

    // Carpetas primero, después archivos; alfabético dentro de cada grupo.
    const names = entries
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
      );

    const truncated = names.length > MAX_LIST_ENTRIES;
    const shown = truncated ? names.slice(0, MAX_LIST_ENTRIES) : names;
    const body = shown.map((e) => (e.isDir ? `${e.name}/` : e.name)).join("\n");

    const header = `${dir} (${names.length} entradas${truncated ? `, mostrando ${MAX_LIST_ENTRIES}` : ""})`;
    const out = names.length === 0 ? `${header}\n(vacío)` : `${header}\n${body}`;
    return { output: out, isError: false };
  },
};
