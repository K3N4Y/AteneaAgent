import { test } from "node:test";
import assert from "node:assert/strict";

import { formatHeader, parseRanges, buildNumbered, type Range } from "./format";

test("formatHeader", () => {
  assert.equal(formatHeader("src/foo.ts", "AB12"), "[src/foo.ts#AB12]");
});

// parseRanges(range, total): casos table-driven. total fijo en 100.
const cases: Array<[input: string | undefined, expected: Range[]]> = [
  [undefined, [[1, 100]]], //            sin rango → archivo entero
  ["", [[1, 100]]], //                   vacío → archivo entero
  ["   ", [[1, 100]]], //                solo espacios → archivo entero
  ["41-80", [[41, 80]]], //              rango cerrado
  ["10+5", [[10, 14]]], //               "desde 10, 5 líneas"
  ["42", [[42, 42]]], //                 una sola línea
  ["-20", [[1, 20]]], //                 abierto por la izquierda → desde 1
  ["50-", [[50, 100]]], //               abierto por la derecha → hasta total
  [
    "5-16,80-90",
    [
      [5, 16],
      [80, 90],
    ],
  ], //lista por comas
  ["0-5", [[1, 5]]], //                  clamp inferior a 1
  ["90-9999", [[90, 100]]], //           clamp superior a total
  ["10-5", [[1, 100]]], //               end<start se descarta → fallback entero
  ["abc", [[1, 100]]], //                token inválido → fallback entero
  ["5,abc", [[5, 5]]], //                token inválido ignorado, el válido queda
];

for (const [input, expected] of cases) {
  test(`parseRanges(${JSON.stringify(input)}, 100)`, () => {
    assert.deepEqual(parseRanges(input, 100), expected);
  });
}

test("buildNumbered: numera 1-indexado el rango dado", () => {
  const lines = ["a", "b", "c", "d"];
  assert.equal(buildNumbered(lines, [[2, 3]]), "2:b\n3:c");
});

test("buildNumbered: índice fuera de rango → línea vacía", () => {
  assert.equal(buildNumbered(["a", "b"], [[1, 3]]), "1:a\n2:b\n3:");
});

test("buildNumbered: concatena múltiples rangos", () => {
  const lines = ["a", "b", "c", "d", "e"];
  assert.equal(
    buildNumbered(lines, [
      [1, 1],
      [4, 5],
    ]),
    "1:a\n4:d\n5:e",
  );
});
