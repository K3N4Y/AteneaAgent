import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { resolveWithinProject } from "./fs-safe";
import type { ToolContext } from "./types";
import { normalize } from "../edit/hashline/hash";

function realpathOfNearestExistingSync(abs: string): string {
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      const real = realpathSync.native(cur);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

export function canonicalSnapshotPath(path: string, ctx: ToolContext): string {
  const abs = resolveWithinProject(path, ctx);
  const realRoot = realpathSync.native(resolve(ctx.projectRoot));
  const realAbs = realpathOfNearestExistingSync(abs);
  const rel = relative(realRoot, realAbs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Ruta fuera del proyecto activo (symlink): ${path}`);
  }
  return realAbs;
}

export function normalizeSnapshotText(text: string): string {
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return normalize(withoutBom);
}
