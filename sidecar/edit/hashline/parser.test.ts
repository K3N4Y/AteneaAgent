import { test } from "node:test";
import assert from "node:assert/strict";

import { parseHashline, ParseError, type Section } from "./parser";
import { MAX_EDIT_INPUT_BYTES, MAX_EDIT_OPS } from "../../config/limits";

/** Atajo: parsea y devuelve la (única) sección esperada. */
function one(input: string): Section {
  const sections = parseHashline(input);
  assert.equal(sections.length, 1);
  return sections[0];
}

test("cabecera: extrae path y tag", () => {
  const s = one("[src/foo.ts#AB12]\nDEL 1");
  assert.equal(s.path, "src/foo.ts");
  assert.equal(s.tag, "AB12");
});

test("SWAP simple y con rango", () => {
  assert.deepEqual(one("[f#T]\nSWAP 3:\n+nuevo").ops, [
    { kind: "swap", start: 3, end: 3, body: ["nuevo"] },
  ]);
  assert.deepEqual(one("[f#T]\nSWAP 3.=5:\n+a\n+b").ops, [
    { kind: "swap", start: 3, end: 5, body: ["a", "b"] },
  ]);
});

test("DEL simple y con rango (sin cuerpo)", () => {
  assert.deepEqual(one("[f#T]\nDEL 4").ops, [
    { kind: "del", start: 4, end: 4 },
  ]);
  assert.deepEqual(one("[f#T]\nDEL 4.=6").ops, [
    { kind: "del", start: 4, end: 6 },
  ]);
});

test("INS.PRE / INS.POST / INS.HEAD / INS.TAIL", () => {
  assert.deepEqual(one("[f#T]\nINS.PRE 2:\n+x").ops, [
    { kind: "ins_pre", line: 2, body: ["x"] },
  ]);
  assert.deepEqual(one("[f#T]\nINS.POST 2:\n+x").ops, [
    { kind: "ins_post", line: 2, body: ["x"] },
  ]);
  assert.deepEqual(one("[f#T]\nINS.HEAD:\n+x").ops, [
    { kind: "ins_head", body: ["x"] },
  ]);
  assert.deepEqual(one("[f#T]\nINS.TAIL:\n+x").ops, [
    { kind: "ins_tail", body: ["x"] },
  ]);
});

test("cuerpo: '+' solo es línea en blanco; el resto es texto literal", () => {
  assert.deepEqual(one("[f#T]\nINS.HEAD:\n+\n+texto").ops[0], {
    kind: "ins_head",
    body: ["", "texto"],
  });
});

test("líneas en blanco entre ops se ignoran", () => {
  assert.equal(one("[f#T]\nDEL 1\n\n   \nDEL 2").ops.length, 2);
});

test("múltiples secciones", () => {
  const sections = parseHashline("[a#T]\nDEL 1\n[b#U]\nDEL 2");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].path, "a");
  assert.equal(sections[1].path, "b");
});

// ── Errores ──────────────────────────────────────────────────────────────────

test("rechaza cuerpo '+' sin una op que acepte cuerpo", () => {
  assert.throws(() => parseHashline("[f#T]\nDEL 1\n+huerfano"), ParseError);
});

test("rechaza una op fuera de cualquier sección", () => {
  assert.throws(() => parseHashline("DEL 1"), ParseError);
});

test("rechaza una op no reconocida", () => {
  assert.throws(() => parseHashline("[f#T]\nFOO 1"), ParseError);
});

test("rechaza input sin ninguna sección", () => {
  assert.throws(() => parseHashline("solo texto plano"), ParseError);
});

test("rechaza superar MAX_EDIT_OPS", () => {
  const ops = Array.from(
    { length: MAX_EDIT_OPS + 1 },
    (_, i) => `DEL ${i + 1}`,
  );
  assert.throws(() => parseHashline(`[f#T]\n${ops.join("\n")}`), ParseError);
});

test("rechaza input que excede MAX_EDIT_INPUT_BYTES", () => {
  const huge = "a".repeat(MAX_EDIT_INPUT_BYTES + 1);
  assert.throws(() => parseHashline(huge), ParseError);
});
