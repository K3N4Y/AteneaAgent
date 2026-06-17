// Normalización + hash corto de archivo (estilo oh-my-pi "hashline").
//
// El hash es una ETIQUETA rápida (4 hex) para detectar "el archivo cambió desde
// que lo leíste", NO seguridad. La verificación real se apoya además en el
// snapshot (las líneas exactas leídas).

import { createHash } from "node:crypto";

/** CRLF/CR → LF para que el hash no cambie por detalles invisibles. */
export function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** 4 hex en mayúsculas del sha256 del contenido normalizado. */
export function computeFileHash(text: string): string {
  const h = createHash("sha256").update(normalize(text)).digest("hex");
  return h.slice(0, 4).toUpperCase();
}

/** Divide en líneas el texto ya normalizado. */
export function toLines(text: string): string[] {
  return normalize(text).split("\n");
}
