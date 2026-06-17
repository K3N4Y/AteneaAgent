// Parser del input de `edit_file`: una o más secciones, cada una con su
// cabecera [PATH#TAG] y operaciones por número de línea.
//
// Ops del MVP (sin tree-sitter / sin `.BLK`):
//   SWAP N.=M:   reemplaza N..M por las filas +TEXTO de abajo   (cuerpo)
//   SWAP N:      = SWAP N.=N
//   DEL  N.=M    borra N..M                                      (sin cuerpo)
//   DEL  N       = DEL N.=N
//   INS.PRE  N:  inserta antes de N                              (cuerpo)
//   INS.POST N:  inserta después de N                            (cuerpo)
//   INS.HEAD:    inserta al inicio del archivo                   (cuerpo)
//   INS.TAIL:    inserta al final del archivo                    (cuerpo)
//
// Filas de cuerpo: empiezan con `+`; `+` solo = línea en blanco.

import { normalize } from "./hash";

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

const HEADER = /^\[(.+)#([^\]#]+)\]\s*$/;
const RE_SWAP = /^SWAP\s+(\d+)(?:\.=(\d+))?:\s*$/;
const RE_DEL = /^DEL\s+(\d+)(?:\.=(\d+))?\s*$/;
const RE_INS_PRE = /^INS\.PRE\s+(\d+):\s*$/;
const RE_INS_POST = /^INS\.POST\s+(\d+):\s*$/;
const RE_INS_HEAD = /^INS\.HEAD:\s*$/;
const RE_INS_TAIL = /^INS\.TAIL:\s*$/;

export class ParseError extends Error {}

export function parseHashline(input: string): Section[] {
  const lines = normalize(input).split("\n");
  const sections: Section[] = [];

  let section: Section | undefined;
  let op: Op | undefined; // op en construcción (acumulando cuerpo)

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
      section = { path: header[1], tag: header[2], ops: [] };
      continue;
    }

    // Fila de cuerpo: pertenece a la op actual (si admite cuerpo).
    if (line.startsWith("+")) {
      if (!op || !("body" in op)) {
        throw new ParseError(
          `Fila de cuerpo "+" sin una operación que acepte cuerpo (línea ${i + 1}).`,
        );
      }
      op.body.push(line.slice(1));
      continue;
    }

    // Línea en blanco / sólo espacios: separador, se ignora.
    if (line.trim() === "") continue;

    // A partir de aquí debe ser una operación nueva.
    if (!section) {
      throw new ParseError(
        `Operación fuera de una sección [PATH#TAG] (línea ${i + 1}): ${line}`,
      );
    }
    flushOp();

    let m: RegExpMatchArray | null;
    if ((m = line.match(RE_SWAP))) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : start;
      op = { kind: "swap", start, end, body: [] };
    } else if ((m = line.match(RE_DEL))) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : start;
      section.ops.push({ kind: "del", start, end });
      op = undefined; // DEL no lleva cuerpo
    } else if ((m = line.match(RE_INS_PRE))) {
      op = { kind: "ins_pre", line: Number(m[1]), body: [] };
    } else if ((m = line.match(RE_INS_POST))) {
      op = { kind: "ins_post", line: Number(m[1]), body: [] };
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
  return sections;
}
