// Parser del input de `edit_file`: una o más secciones [PATH#TAG] con
// operaciones concretas por número de línea.
//
// Soporta sólo el contrato disponible en MyAgent:
//   SWAP N.=M:   reemplaza N..M por las filas +TEXTO de abajo
//   SWAP N:      = SWAP N.=N
//   DEL  N.=M    borra N..M
//   DEL  N       = DEL N.=N
//   INS.PRE  N:  inserta antes de N
//   INS.POST N:  inserta después de N
//   INS.HEAD:    inserta al inicio del archivo
//   INS.TAIL:    inserta al final del archivo

import { normalize } from "./hash";
import { MAX_EDIT_INPUT_BYTES, MAX_EDIT_OPS } from "../../config/limits";

export type Op =
  | { kind: "swap"; start: number; end: number; body: string[] }
  | { kind: "del"; start: number; end: number }
  | { kind: "ins_pre"; line: number; body: string[] }
  | { kind: "ins_post"; line: number; body: string[] }
  | { kind: "ins_head"; body: string[] }
  | { kind: "ins_tail"; body: string[] };

export interface Section {
  path: string;
  tag: string;
  ops: Op[];
}

const HEADER = /^\[(.+)#([0-9A-Fa-f]{4})\]\s*$/;
const RE_SWAP = /^SWAP\s+(\d+)(?:\.=(\d+))?:\s*$/;
const RE_DEL = /^DEL\s+(\d+)(?:\.=(\d+))?\s*$/;
const RE_INS_PRE = /^INS\.PRE\s+(\d+):\s*$/;
const RE_INS_POST = /^INS\.POST\s+(\d+):\s*$/;
const RE_INS_HEAD = /^INS\.HEAD:\s*$/;
const RE_INS_TAIL = /^INS\.TAIL:\s*$/;

export class ParseError extends Error {}

export function parseHashline(input: string): Section[] {
  const bytes = Buffer.byteLength(input, "utf8");
  if (bytes > MAX_EDIT_INPUT_BYTES) {
    throw new ParseError(
      `El input de edit_file es demasiado grande (${bytes} bytes; máx ${MAX_EDIT_INPUT_BYTES}).`,
    );
  }

  const lines = normalize(input).split("\n");
  const sections: Section[] = [];
  let section: Section | undefined;
  let op: Op | undefined;

  const flushOp = () => {
    if (op && section) section.ops.push(op);
    op = undefined;
  };
  const flushSection = () => {
    flushOp();
    if (section) sections.push(section);
    section = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const header = line.match(HEADER);
    if (header) {
      flushSection();
      section = { path: header[1], tag: header[2].toUpperCase(), ops: [] };
      continue;
    }

    if (line.startsWith("+")) {
      if (!op || !("body" in op)) {
        throw new ParseError(
          `Fila de cuerpo "+" sin una operación que acepte cuerpo (línea ${i + 1}).`,
        );
      }
      op.body.push(line.slice(1));
      continue;
    }

    if (line.trim() === "") continue;

    if (!section) {
      throw new ParseError(
        `Operación fuera de una sección [PATH#TAG] (línea ${i + 1}): ${line}`,
      );
    }
    flushOp();

    let match: RegExpMatchArray | null;
    if ((match = line.match(RE_SWAP))) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      op = { kind: "swap", start, end, body: [] };
    } else if ((match = line.match(RE_DEL))) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      section.ops.push({ kind: "del", start, end });
      op = undefined;
    } else if ((match = line.match(RE_INS_PRE))) {
      op = { kind: "ins_pre", line: Number(match[1]), body: [] };
    } else if ((match = line.match(RE_INS_POST))) {
      op = { kind: "ins_post", line: Number(match[1]), body: [] };
    } else if (RE_INS_HEAD.test(line)) {
      op = { kind: "ins_head", body: [] };
    } else if (RE_INS_TAIL.test(line)) {
      op = { kind: "ins_tail", body: [] };
    } else {
      throw new ParseError(`Operación no reconocida (línea ${i + 1}): ${line}`);
    }
  }

  flushSection();

  if (sections.length === 0) {
    throw new ParseError(
      "No se encontró ninguna sección [PATH#TAG] en el input de edit_file.",
    );
  }

  const opCount = sections.reduce((count, item) => count + item.ops.length, 0);
  if (opCount > MAX_EDIT_OPS) {
    throw new ParseError(
      `Demasiadas operaciones en un solo edit_file (${opCount}; máx ${MAX_EDIT_OPS}).`,
    );
  }
  return sections;
}
