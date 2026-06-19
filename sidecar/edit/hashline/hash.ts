// Normalización + hash corto de archivo para hashline.

import { computeFileHash } from "./format";

export { computeFileHash };

/** CRLF/CR -> LF para que el hash no cambie por finales de línea. */
export function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Divide en líneas el texto normalizado. */
export function toLines(text: string): string[] {
  return normalize(text).split("\n");
}
