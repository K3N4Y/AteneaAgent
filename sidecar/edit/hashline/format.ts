// Formato de salida de `read_file`: cabecera [PATH#TAG] + líneas "N:TEXTO",
// y parseo de rangos simples para leer sólo parte del archivo.

import { createHash } from "node:crypto";

export const HASHLINE_HASH_LENGTH = 4;

export function computeFileHash(text: string): string {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"))
    .digest("hex")
    .slice(0, HASHLINE_HASH_LENGTH)
    .toUpperCase();
}

export function formatHeader(path: string, hash: string): string {
  return `[${path}#${hash}]`;
}

export function formatNumberedLine(lineNumber: number, line: string): string {
  return `${lineNumber}:${line}`;
}

/** Rango 1-indexado, inclusivo en ambos extremos. */
export type Range = [start: number, end: number];

/**
 * Parsea selectores: "41-80", "10+5", "42", "100-", "-20", y listas
 * separadas por coma. Tokens inválidos se ignoran; si ninguno sirve, lee todo.
 */
export function parseRanges(range: string | undefined, total: number): Range[] {
  if (!range || !range.trim()) return [[1, total]];

  const ranges: Range[] = [];
  for (const tokenRaw of range.split(",")) {
    const token = tokenRaw.trim();
    if (!token) continue;

    let start: number;
    let end: number;
    const plus = token.match(/^(\d+)\+(\d+)$/);
    const dash = token.match(/^(\d*)-(\d*)$/);

    if (plus) {
      start = Number(plus[1]);
      end = start + Number(plus[2]) - 1;
    } else if (dash) {
      start = dash[1] ? Number(dash[1]) : 1;
      end = dash[2] ? Number(dash[2]) : total;
    } else if (/^\d+$/.test(token)) {
      start = end = Number(token);
    } else {
      continue;
    }

    start = Math.max(1, Math.min(start, total));
    end = Math.max(1, Math.min(end, total));
    if (end >= start) ranges.push([start, end]);
  }

  return ranges.length > 0 ? ranges : [[1, total]];
}

/** Construye el cuerpo numerado "N:TEXTO" para los rangos dados. */
export function buildNumbered(lines: string[], ranges: Range[]): string {
  const out: string[] = [];
  for (const [start, end] of ranges) {
    for (let line = start; line <= end; line++) {
      out.push(formatNumberedLine(line, lines[line - 1] ?? ""));
    }
  }
  return out.join("\n");
}
