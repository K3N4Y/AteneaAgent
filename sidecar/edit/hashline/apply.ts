// Aplica operaciones hashline concretas sobre las líneas de un archivo.
//
// Las operaciones se ordenan de MAYOR a MENOR ancla antes de aplicarse para que
// insertar/borrar no desplace los índices de las operaciones siguientes.

import type { Op } from "./parser";

export class ApplyError extends Error {}

function anchor(op: Op): number {
  switch (op.kind) {
    case "swap":
    case "del":
      return op.start;
    case "ins_pre":
      return op.line - 0.5;
    case "ins_post":
      return op.line + 0.5;
    case "ins_head":
      return -Infinity;
    case "ins_tail":
      return Infinity;
  }
}

function validate(op: Op, total: number): void {
  const inRange = (n: number) => n >= 1 && n <= total;
  switch (op.kind) {
    case "swap":
    case "del":
      if (!inRange(op.start) || !inRange(op.end) || op.start > op.end) {
        throw new ApplyError(
          `Rango inválido ${op.start}.=${op.end} (el archivo tiene ${total} líneas).`,
        );
      }
      return;
    case "ins_pre":
      if (!inRange(op.line)) {
        throw new ApplyError(`INS.PRE ${op.line} fuera de rango (1..${total}).`);
      }
      return;
    case "ins_post":
      if (!inRange(op.line)) {
        throw new ApplyError(`INS.POST ${op.line} fuera de rango (1..${total}).`);
      }
      return;
    case "ins_head":
    case "ins_tail":
      return;
  }
}

/** Devuelve un nuevo arreglo de líneas con las ops aplicadas literalmente. */
export function applyOps(lines: string[], ops: Op[]): string[] {
  const total = lines.length;
  for (const op of ops) validate(op, total);

  const ordered = [...ops].sort((a, b) => anchor(b) - anchor(a));
  const out = [...lines];

  for (const op of ordered) {
    switch (op.kind) {
      case "swap":
        out.splice(op.start - 1, op.end - op.start + 1, ...op.body);
        break;
      case "del":
        out.splice(op.start - 1, op.end - op.start + 1);
        break;
      case "ins_pre":
        out.splice(op.line - 1, 0, ...op.body);
        break;
      case "ins_post":
        out.splice(op.line, 0, ...op.body);
        break;
      case "ins_head":
        out.splice(0, 0, ...op.body);
        break;
      case "ins_tail":
        out.splice(out.length, 0, ...op.body);
        break;
    }
  }

  return out;
}

/** Diff compacto para la respuesta de edit_file. */
export function diffPreview(before: string[], after: string[]): string {
  let pre = 0;
  while (
    pre < before.length &&
    pre < after.length &&
    before[pre] === after[pre]
  ) {
    pre++;
  }

  let suf = 0;
  while (
    suf < before.length - pre &&
    suf < after.length - pre &&
    before[before.length - 1 - suf] === after[after.length - 1 - suf]
  ) {
    suf++;
  }

  const removed = before.slice(pre, before.length - suf);
  const added = after.slice(pre, after.length - suf);
  if (removed.length === 0 && added.length === 0) return "(sin cambios)";

  const out: string[] = [];
  removed.forEach((line, i) => out.push(`-${pre + i + 1}:${line}`));
  added.forEach((line, i) => out.push(`+${pre + i + 1}:${line}`));
  return out.join("\n");
}
