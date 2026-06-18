import { test } from "node:test";
import assert from "node:assert/strict";

import { applyOps, diffPreview, ApplyError } from "./apply";
import type { Op } from "./parser";

const base = () => ["a", "b", "c", "d"];

test("swap: reemplaza una línea", () => {
  const op: Op = { kind: "swap", start: 2, end: 2, body: ["X"] };
  assert.deepEqual(applyOps(base(), [op]), ["a", "X", "c", "d"]);
});

test("swap: reemplaza un rango por un cuerpo de distinto tamaño", () => {
  const op: Op = { kind: "swap", start: 2, end: 3, body: ["X", "Y", "Z"] };
  assert.deepEqual(applyOps(base(), [op]), ["a", "X", "Y", "Z", "d"]);
});

test("del: borra un rango", () => {
  const op: Op = { kind: "del", start: 2, end: 3 };
  assert.deepEqual(applyOps(base(), [op]), ["a", "d"]);
});

test("ins_pre / ins_post / ins_head / ins_tail", () => {
  assert.deepEqual(
    applyOps(base(), [{ kind: "ins_pre", line: 2, body: ["X"] }]),
    ["a", "X", "b", "c", "d"],
  );
  assert.deepEqual(
    applyOps(base(), [{ kind: "ins_post", line: 2, body: ["X"] }]),
    ["a", "b", "X", "c", "d"],
  );
  assert.deepEqual(applyOps(base(), [{ kind: "ins_head", body: ["X"] }]), [
    "X",
    "a",
    "b",
    "c",
    "d",
  ]);
  assert.deepEqual(applyOps(base(), [{ kind: "ins_tail", body: ["X"] }]), [
    "a",
    "b",
    "c",
    "d",
    "X",
  ]);
});

test("ins_post en la última línea hace append (line === total es válido)", () => {
  assert.deepEqual(
    applyOps(base(), [{ kind: "ins_post", line: 4, body: ["X"] }]),
    ["a", "b", "c", "d", "X"],
  );
});

test("invariante de orden: varias ops no corren los índices entre sí", () => {
  // del de la línea 1 + insert tras la 4: el orden (mayor→menor ancla) lo resuelve.
  const ops: Op[] = [
    { kind: "del", start: 1, end: 1 },
    { kind: "ins_post", line: 4, body: ["E"] },
  ];
  assert.deepEqual(applyOps(base(), ops), ["b", "c", "d", "E"]);
});

test("invariante de orden: swap + del combinados", () => {
  const lines = ["l1", "l2", "l3", "l4", "l5"];
  const ops: Op[] = [
    { kind: "swap", start: 2, end: 2, body: ["X"] },
    { kind: "del", start: 4, end: 4 },
  ];
  assert.deepEqual(applyOps(lines, ops), ["l1", "X", "l3", "l5"]);
});

test("no muta el arreglo de entrada", () => {
  const input = base();
  applyOps(input, [{ kind: "del", start: 1, end: 1 }]);
  assert.deepEqual(input, ["a", "b", "c", "d"]);
});

test("ApplyError en rangos fuera de límites", () => {
  const total = base(); // 4 líneas
  assert.throws(
    () => applyOps(total, [{ kind: "swap", start: 0, end: 1, body: [] }]),
    ApplyError,
  );
  assert.throws(
    () => applyOps(total, [{ kind: "del", start: 3, end: 9 }]),
    ApplyError,
  );
  assert.throws(
    () => applyOps(total, [{ kind: "swap", start: 3, end: 2, body: [] }]),
    ApplyError,
  );
  assert.throws(
    () => applyOps(total, [{ kind: "ins_pre", line: 5, body: [] }]),
    ApplyError,
  );
  assert.throws(
    () => applyOps(total, [{ kind: "ins_post", line: 5, body: [] }]),
    ApplyError,
  );
});

// ── diffPreview ───────────────────────────────────────────────────────────────

test("diffPreview: sin cambios", () => {
  assert.equal(diffPreview(["a", "b"], ["a", "b"]), "(sin cambios)");
});

test("diffPreview: reemplazo recorta prefijo/sufijo común", () => {
  assert.equal(diffPreview(["a", "b", "c"], ["a", "X", "c"]), "-2:b\n+2:X");
});

test("diffPreview: pura adición", () => {
  assert.equal(diffPreview(["a", "b"], ["a", "b", "c"]), "+3:c");
});

test("diffPreview: pura eliminación", () => {
  assert.equal(diffPreview(["a", "b", "c"], ["a", "c"]), "-2:b");
});
