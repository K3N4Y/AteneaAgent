// search: busca texto dentro de los archivos del proyecto (estilo grep).
// Recorre el árbol desde `path` (por defecto la raíz), salta directorios
// pesados (node_modules, .git, …) y archivos binarios/enormes, y devuelve
// coincidencias como "path:línea:texto". Read-only: disponible para Plan.

import { z } from "zod";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { type Tool, type ToolResult } from "./types";
import { secureResolveWithinProject, readdirWithinProject } from "./fs-safe";
import {
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_FILE_BYTES,
  MAX_SEARCH_FILES,
} from "../config/limits";

// Directorios que casi nunca querés buscar: ruido y volumen.
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "coverage",
  ".cache",
]);

const schema = z.object({
  query: z.string().min(1).describe("Texto a buscar (subcadena, o regex si regex:true)."),
  path: z
    .string()
    .optional()
    .describe('Subdirectorio donde buscar, relativo a la raíz. Por defecto "." (todo el proyecto).'),
  regex: z.boolean().optional().describe("Interpretar query como expresión regular (por defecto false)."),
  ignoreCase: z.boolean().optional().describe("Ignorar mayúsculas/minúsculas (por defecto false)."),
});

export const searchTool: Tool<z.infer<typeof schema>> = {
  name: "search",
  description:
    "Busca texto en los archivos del proyecto (como grep -rn). Devuelve líneas " +
    '"path:línea:texto". Salta node_modules/.git/dist y binarios. Aceptá un ' +
    "subdirectorio para acotar y regex/ignoreCase para afinar.",
  schema,
  async run({ query, path, regex, ignoreCase }, ctx): Promise<ToolResult> {
    let matcher: (line: string) => boolean;
    if (regex) {
      try {
        const re = new RegExp(query, ignoreCase ? "i" : "");
        matcher = (line) => re.test(line);
      } catch (err) {
        return { output: `Regex inválida: ${(err as Error).message}`, isError: true };
      }
    } else {
      const needle = ignoreCase ? query.toLowerCase() : query;
      matcher = ignoreCase
        ? (line) => line.toLowerCase().includes(needle)
        : (line) => line.includes(needle);
    }

    const root = ctx.projectRoot;
    const start = path && path.trim() ? path : ".";
    let startAbs: string;
    try {
      startAbs = await secureResolveWithinProject(start, ctx);
    } catch (err) {
      return { output: `Ruta inválida ${start}: ${(err as Error).message}`, isError: true };
    }

    const results: string[] = [];
    let filesVisited = 0;
    let truncated = false;

    const walk = async (absDir: string, relDir: string): Promise<void> => {
      if (truncated) return;
      let entries;
      try {
        entries = await readdir(absDir, { withFileTypes: true });
      } catch {
        return; // un dir ilegible no debe abortar toda la búsqueda
      }
      for (const e of entries) {
        if (truncated) return;
        // No seguimos symlinks: evita salir del proyecto y bucles.
        if (e.isSymbolicLink()) continue;
        const childRel = relDir === "" ? e.name : `${relDir}/${e.name}`;
        const childAbs = join(absDir, e.name);
        if (e.isDirectory()) {
          if (IGNORE_DIRS.has(e.name)) continue;
          await walk(childAbs, childRel);
        } else if (e.isFile()) {
          if (++filesVisited > MAX_SEARCH_FILES) {
            truncated = true;
            return;
          }
          await scanFile(childAbs, childRel);
        }
      }
    };

    const scanFile = async (absFile: string, relFile: string): Promise<void> => {
      try {
        const st = await stat(absFile);
        if (st.size > MAX_SEARCH_FILE_BYTES) return;
        const buf = await readFile(absFile);
        if (buf.includes(0)) return; // byte NUL ⇒ lo saltamos (binario / UTF-16 / UTF-32 — heurística, no detector formal)
        const lines = buf.toString("utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (matcher(lines[i])) {
            results.push(`${relFile}:${i + 1}:${lines[i].slice(0, 300)}`);
            if (results.length >= MAX_SEARCH_RESULTS) {
              truncated = true;
              return;
            }
          }
        }
      } catch {
        // archivo ilegible: lo ignoramos
      }
    };

    // Si `start` apunta a un archivo, escaneamos sólo ese; si a un dir, caminamos.
    try {
      const st = await stat(startAbs);
      if (st.isFile()) {
        await scanFile(startAbs, relative(root, startAbs).split("\\").join("/"));
      } else {
        await walk(startAbs, start === "." ? "" : start);
      }
    } catch (err) {
      return { output: `No se pudo buscar en ${start}: ${(err as Error).message}`, isError: true };
    }

    if (results.length === 0) {
      return { output: `Sin coincidencias para ${JSON.stringify(query)}.`, isError: false };
    }
    const note = truncated
      ? `\n… (truncado en ${results.length} coincidencias; afiná la búsqueda)`
      : `\n(${results.length} coincidencias)`;
    return { output: results.join("\n") + note, isError: false };
  },
};
