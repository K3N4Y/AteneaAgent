// edit_file: aplica ediciones hashline concretas sobre archivos existentes.
// Cada sección debe usar la cabecera [PATH#TAG] devuelta por read_file/search.

import { z } from "zod";

import { type Tool, type ToolResult } from "./types";
import { readWithinProject, writeWithinProject } from "./fs-safe";
import {
  canonicalSnapshotPath,
  normalizeSnapshotText,
} from "./hashline-filesystem";
import { applyOps, diffPreview } from "../edit/hashline/apply";
import { formatHeader } from "../edit/hashline/format";
import { computeFileHash, toLines } from "../edit/hashline/hash";
import { parseHashline, type Op, type Section } from "../edit/hashline/parser";

const schema = z.object({
  input: z
    .string()
    .describe(
      "Ediciones hashline. Cada sección: cabecera [PATH#TAG] seguida de ops " +
        "SWAP/DEL/INS.PRE/INS.POST/INS.HEAD/INS.TAIL. Las filas de cuerpo empiezan con '+'.",
    ),
});

interface Planned {
  path: string;
  canonicalPath: string;
  before: string[];
  after: string[];
  newHash: string;
}

export const editFileTool: Tool<z.infer<typeof schema>> = {
  name: "edit_file",
  description:
    "Modifica archivos EXISTENTES con ediciones hashline ancladas a [PATH#TAG] " +
    "de read_file/search. Soporta SWAP, DEL, INS.PRE, INS.POST, INS.HEAD e " +
    "INS.TAIL. Si el archivo cambió desde la lectura, falla y pide re-leer. " +
    "Para crear un archivo nuevo usá write_file.",
  schema,
  async run({ input }, ctx): Promise<ToolResult> {
    let sections: Section[];
    try {
      sections = parseHashline(input);
    } catch (err) {
      return {
        output: `Error de formato hashline: ${(err as Error).message}`,
        isError: true,
      };
    }

    const planned: Planned[] = [];
    const plannedPaths = new Set<string>();
    for (const section of sections) {
      let current: string;
      let canonicalPath: string;
      try {
        current = await readWithinProject(section.path, ctx);
        canonicalPath = canonicalSnapshotPath(section.path, ctx);
      } catch (err) {
        return {
          output:
            `No se pudo leer ${section.path} para editar: ${(err as Error).message}. ` +
            `Si el archivo no existe, usá write_file para crearlo.`,
          isError: true,
        };
      }
      if (plannedPaths.has(canonicalPath)) {
        return {
          output:
            `edit_file recibió más de una sección para ${section.path}. ` +
            `Combiná todas las operaciones de ese archivo en un solo bloque [PATH#TAG].`,
          isError: true,
        };
      }
      plannedPaths.add(canonicalPath);

      const normalized = normalizeSnapshotText(current);
      const currentHash = computeFileHash(normalized);
      const before = toLines(normalized);
      const snapshot = ctx.snapshots.byHash(canonicalPath, section.tag);
      if (
        currentHash !== section.tag ||
        snapshot === undefined ||
        snapshot.text !== normalized
      ) {
        return {
          output: mismatchMessage(section, before, currentHash, snapshot),
          isError: true,
        };
      }

      const unseen = unseenAnchorLines(section, snapshot.seenLines);
      if (unseen.length > 0) {
        return {
          output: unseenLinesMessage(section.path, unseen, section.tag),
          isError: true,
        };
      }

      let after: string[];
      try {
        after = applyOps(before, section.ops);
      } catch (err) {
        return {
          output: `Error aplicando ops en ${section.path}: ${(err as Error).message}`,
          isError: true,
        };
      }

      planned.push({
        path: section.path,
        canonicalPath,
        before,
        after,
        newHash: computeFileHash(after.join("\n")),
      });
    }

    const results: string[] = [];
    for (const item of planned) {
      const afterText = item.after.join("\n");
      try {
        await writeWithinProject(item.path, afterText, ctx);
      } catch (err) {
        return {
          output: `No se pudo escribir ${item.path}: ${(err as Error).message}`,
          isError: true,
        };
      }
      ctx.snapshots.record(item.canonicalPath, afterText);
      results.push(
        `${formatHeader(item.path, item.newHash)}\n${diffPreview(item.before, item.after)}`,
      );
    }

    return { output: results.join("\n\n"), isError: false };
  },
};

function collectAnchorLines(ops: readonly Op[]): number[] {
  const lines: number[] = [];
  for (const op of ops) {
    switch (op.kind) {
      case "swap":
      case "del":
        for (let line = op.start; line <= op.end; line++) lines.push(line);
        break;
      case "ins_pre":
      case "ins_post":
        lines.push(op.line);
        break;
      case "ins_head":
      case "ins_tail":
        break;
    }
  }
  return [...new Set(lines)].sort((a, b) => a - b);
}

function unseenAnchorLines(
  section: Section,
  seen: Set<number> | undefined,
): number[] {
  if (!seen || seen.size === 0) return [];
  return collectAnchorLines(section.ops).filter((line) => !seen.has(line));
}

function formatLineRanges(lines: readonly number[]): string {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current!;
    prev = current!;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(", ");
}

function unseenLinesMessage(
  path: string,
  lines: readonly number[],
  tag: string,
): string {
  const ranges = formatLineRanges(lines);
  return (
    `Este edit ancla líneas no mostradas por [${path}#${tag}]: ${ranges}. ` +
    `Re-leé esas líneas con read_file antes de editar.`
  );
}

function mismatchMessage(
  section: Section,
  currentLines: string[],
  currentHash: string,
  snapshot: { text: string } | undefined,
): string {
  const anchors = collectAnchorLines(section.ops);
  const context = formatContext(currentLines, anchors);
  const reason =
    snapshot === undefined
      ? "el tag no corresponde a una versión vigente de esta sesión"
      : "el archivo cambió desde que lo leíste";
  return (
    `Edit rejected for ${section.path}: ${reason} ` +
    `(esperaba #${section.tag}, ahora es #${currentHash}). ` +
    `Volvé a leerlo con read_file/search y reemití el edit con la cabecera nueva.` +
    (context ? `\n${formatHeader(section.path, currentHash)}\n${context}` : "")
  );
}

function formatContext(lines: string[], anchors: readonly number[]): string {
  const display = new Set<number>();
  for (const anchor of anchors) {
    for (
      let line = Math.max(1, anchor - 2);
      line <= Math.min(lines.length, anchor + 2);
      line++
    ) {
      display.add(line);
    }
  }
  return [...display]
    .sort((a, b) => a - b)
    .map((line) => `${line}:${lines[line - 1] ?? ""}`)
    .join("\n");
}
