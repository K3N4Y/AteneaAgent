// Acceso a archivos restringido a la raíz del proyecto activo. Toda ruta del
// modelo se resuelve aquí y se valida que no escape del directorio (sin `../`).

import { resolve, relative, isAbsolute, dirname, sep } from "node:path";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";

import { ToolError, type ToolContext } from "./types";

/** Resuelve `p` contra la raíz del proyecto y rechaza si se sale de ella. */
export function resolveWithinProject(p: string, ctx: ToolContext): string {
  const root = resolve(ctx.projectRoot);
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ToolError(`Ruta fuera del proyecto activo: ${p}`);
  }
  return abs;
}

export async function readWithinProject(
  p: string,
  ctx: ToolContext,
): Promise<string> {
  const abs = resolveWithinProject(p, ctx);
  return readFile(abs, "utf8");
}

export async function writeWithinProject(
  p: string,
  content: string,
  ctx: ToolContext,
): Promise<void> {
  const abs = resolveWithinProject(p, ctx);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

export async function existsWithinProject(
  p: string,
  ctx: ToolContext,
): Promise<boolean> {
  try {
    await stat(resolveWithinProject(p, ctx));
    return true;
  } catch {
    return false;
  }
}
