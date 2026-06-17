// Acceso a archivos restringido a la raíz del proyecto activo. Toda ruta del
// modelo se resuelve aquí y se valida que no escape del directorio: ni con
// `../` (chequeo léxico) ni vía symlinks que apunten afuera (chequeo real).

import { resolve, relative, isAbsolute, dirname, basename, sep } from "node:path";
import { readFile, writeFile, mkdir, stat, realpath, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";

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

/**
 * Como `resolveWithinProject` pero además resuelve symlinks. El chequeo léxico
 * por sí solo deja pasar un archivo cuyo *nombre* está dentro del proyecto pero
 * que en realidad es un symlink apuntando afuera (p. ej. a /etc/passwd). Acá
 * resolvemos el path real del ancestro que ya existe y re-verificamos que siga
 * dentro de la raíz real antes de leer/escribir.
 */
export async function secureResolveWithinProject(
  p: string,
  ctx: ToolContext,
): Promise<string> {
  const abs = resolveWithinProject(p, ctx); // rechaza `../` primero
  const realRoot = await realpath(resolve(ctx.projectRoot));
  const realAbs = await realpathOfNearestExisting(abs);
  const rel = relative(realRoot, realAbs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ToolError(`Ruta fuera del proyecto activo (symlink): ${p}`);
  }
  return abs;
}

/**
 * `realpath` del ancestro más cercano que exista, re-anexando los segmentos que
 * todavía no existen. Necesario para writes de archivos nuevos: el archivo no
 * existe aún (realpath tiraría ENOENT), pero un directorio ancestro podría ser
 * un symlink que saca la escritura fuera del proyecto.
 */
async function realpathOfNearestExisting(abs: string): Promise<string> {
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      const real = await realpath(cur);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs; // raíz del FS: nada que resolver
      tail.push(basename(cur));
      cur = parent;
    }
  }
}

export async function readWithinProject(
  p: string,
  ctx: ToolContext,
): Promise<string> {
  const abs = await secureResolveWithinProject(p, ctx);
  return readFile(abs, "utf8");
}

export async function writeWithinProject(
  p: string,
  content: string,
  ctx: ToolContext,
): Promise<void> {
  const abs = await secureResolveWithinProject(p, ctx);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

export async function existsWithinProject(
  p: string,
  ctx: ToolContext,
): Promise<boolean> {
  try {
    await stat(await secureResolveWithinProject(p, ctx));
    return true;
  } catch {
    return false;
  }
}

/** Lista las entradas (con tipo) de un directorio del proyecto, ya validado. */
export async function readdirWithinProject(
  p: string,
  ctx: ToolContext,
): Promise<Dirent[]> {
  const abs = await secureResolveWithinProject(p, ctx);
  return readdir(abs, { withFileTypes: true });
}
