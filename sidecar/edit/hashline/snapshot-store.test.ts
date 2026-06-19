import { test } from "node:test";
import assert from "node:assert/strict";

import { SnapshotStore } from "./snapshot-store";

const PATH = "/tmp/hashline-snapshot-store.ts";

test("record returns a deterministic content tag and stores the full text", () => {
  const store = new SnapshotStore();
  const tag = store.record(PATH, "one\ntwo\n");

  assert.match(tag, /^[0-9A-F]{4}$/);
  assert.equal(store.byHash(PATH, tag)?.text, "one\ntwo\n");
  assert.equal(store.head(PATH)?.hash, tag);
});

test("record merges seen lines for identical content", () => {
  const store = new SnapshotStore();
  const tag = store.record(PATH, "one\ntwo\nthree\n", [1]);

  assert.equal(store.record(PATH, "one\ntwo\nthree\n", [3]), tag);
  assert.deepEqual(
    [...(store.byHash(PATH, tag)?.seenLines ?? [])].sort(),
    [1, 3],
  );
});

test("record keeps recent versions per path", () => {
  const store = new SnapshotStore();
  const old = store.record(PATH, "old\n");
  const next = store.record(PATH, "next\n");

  assert.equal(store.byHash(PATH, old)?.text, "old\n");
  assert.equal(store.byHash(PATH, next)?.text, "next\n");
  assert.equal(store.head(PATH)?.hash, next);
});
