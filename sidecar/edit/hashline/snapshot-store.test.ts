import { test } from "node:test";
import assert from "node:assert/strict";

import { SnapshotStore } from "./snapshot-store";
import {
  MAX_SNAPSHOT_VERSIONS_PER_PATH,
  MAX_SNAPSHOT_PATHS,
} from "../../config/limits";

test("record + find: roundtrip por path+hash", () => {
  const s = new SnapshotStore();
  s.record("a.ts", ["l1", "l2"], "AB12");
  assert.deepEqual(s.find("a.ts", "AB12"), {
    hash: "AB12",
    lines: ["l1", "l2"],
  });
});

test("find: undefined para path o hash desconocido", () => {
  const s = new SnapshotStore();
  s.record("a.ts", ["x"], "AB12");
  assert.equal(s.find("otro.ts", "AB12"), undefined);
  assert.equal(s.find("a.ts", "FFFF"), undefined);
});

test("record: mismo hash en cabeza se actualiza in-place (no crece, refresca líneas)", () => {
  const s = new SnapshotStore();
  s.record("a.ts", ["v1"], "AB12");
  s.record("a.ts", ["v2"], "AB12"); // mismo hash en cabeza → reemplaza, no apila
  assert.deepEqual(s.find("a.ts", "AB12"), { hash: "AB12", lines: ["v2"] });
});

test("record: al superar el cap de versiones se descarta la más vieja del path", () => {
  const s = new SnapshotStore();
  const n = MAX_SNAPSHOT_VERSIONS_PER_PATH;
  for (let i = 0; i <= n; i++) s.record("a.ts", [`v${i}`], `H${i}`); // n+1 hashes distintos
  assert.equal(s.find("a.ts", "H0"), undefined); // la más vieja se fue
  assert.ok(s.find("a.ts", "H1")); // las n más nuevas siguen
  assert.ok(s.find("a.ts", `H${n}`));
});

test("record: al superar el tope de paths se evicta el path más viejo", () => {
  const s = new SnapshotStore();
  const n = MAX_SNAPSHOT_PATHS;
  for (let i = 0; i <= n; i++) s.record(`f${i}.ts`, ["x"], "H"); // n+1 paths distintos
  assert.equal(s.find("f0.ts", "H"), undefined); // el más viejo se evictó
  assert.ok(s.find(`f${n}.ts`, "H")); // el más nuevo queda
});
