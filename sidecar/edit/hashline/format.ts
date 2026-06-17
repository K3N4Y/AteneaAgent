// Formato de salida de `read_file`: cabecera [PATH#TAG] + líneas "N:TEXTO",
// y el parseo de rangos simples para leer sólo una parte del archivo.

export function formatHeader(path: string, hash: string): string {
  return `[${path}#${hash}]`;
}

/** Rango 1-indexado, inclusivo en ambos extremos. */
export type Range = [start: number, end: number];

/**
 * Parsea un selector de rango: "41-80", "10+5" (desde 10, 5 líneas), "42"
 * (una línea), "100-" (hasta el final), "-20" (desde el inicio), y listas
 * separadas por comas: "5-16,200-210". Devuelve rangos clampados y ordenados.
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
      continue; // token inválido: lo ignoramos (MVP)
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
    for (let n = start; n <= end; n++) {
      out.push(`${n}:${lines[n - 1] ?? ""}`);
    }
  }
  return out.join("\n");
}
