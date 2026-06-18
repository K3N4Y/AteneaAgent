import { test } from "node:test";
import assert from "node:assert/strict";

import { normalize, computeFileHash, toLines } from "./hash";

test("normalize: CRLF y CR sueltos → LF", () => {
  assert.equal(normalize("a\r\nb"), "a\nb");
  assert.equal(normalize("a\rb"), "a\nb");
  assert.equal(normalize("a\r\n\rb"), "a\n\nb");
  assert.equal(normalize("a\nb"), "a\nb"); // ya normalizado: sin cambios
});

test("computeFileHash: 4 hex en mayúsculas, determinista", () => {
  const h = computeFileHash("hola mundo");
  assert.match(h, /^[0-9A-F]{4}$/);
  assert.equal(h, computeFileHash("hola mundo")); // determinista
  assert.notEqual(h, computeFileHash("hola munde")); // sensible al contenido
});

test("computeFileHash: invariante a CRLF (el hash no cambia por finales de línea)", () => {
  assert.equal(computeFileHash("a\r\nb\r\nc"), computeFileHash("a\nb\nc"));
});

test("toLines: normaliza y separa por LF", () => {
  assert.deepEqual(toLines("a\r\nb\nc"), ["a", "b", "c"]);
  assert.deepEqual(toLines(""), [""]);
  assert.deepEqual(toLines("a\n"), ["a", ""]); // newline final → línea vacía
});
