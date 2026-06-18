// Topes del motor, en un solo lugar para que sean escaneables. La mayoría son
// límites defensivos contra entradas del modelo (que una sola tool-call no
// materialice un archivo gigante ni el loop se coma el presupuesto); están
// holgados respecto de cualquier uso legítimo.

// ── Tamaños de entrada del modelo ────────────────────────────────────────────

/** Tamaño máximo (bytes UTF-8) del contenido de un archivo escrito por una tool. */
export const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

/** Tamaño máximo (bytes UTF-8) del script hashline de un único edit_file. */
export const MAX_EDIT_INPUT_BYTES = 1024 * 1024; // 1 MB

/** Cardinalidad máxima de operaciones en un único edit_file. */
export const MAX_EDIT_OPS = 500;

// ── list_dir / search (tools/list-dir.ts, tools/search.ts) ───────────────────

/** Máximo de entradas que devuelve un list_dir (se trunca con aviso). */
export const MAX_LIST_ENTRIES = 500;

/** Máximo de coincidencias que devuelve un search (se trunca con aviso). */
export const MAX_SEARCH_RESULTS = 200;

/** Archivos más grandes que esto se saltan al hacer search (probablemente binarios). */
export const MAX_SEARCH_FILE_BYTES = 512 * 1024; // 512 KB

/** Tope de archivos visitados en un search, cortafuegos contra árboles enormes. */
export const MAX_SEARCH_FILES = 5000;

// ── run_command (tools/run-command.ts) ───────────────────────────────────────

/** Tiempo máximo de un run_command antes de matarlo. */
export const MAX_COMMAND_MS = 120_000; // 2 min

/** Bytes de salida (stdout+stderr combinados) retenidos de un run_command. */
export const MAX_COMMAND_OUTPUT_BYTES = 100_000; // ~100 KB

// ── Agent loop (engine/loop.ts) ──────────────────────────────────────────────

/**
 * Tope de turnos para evitar bucles infinitos de tool-calling. Sin tope por
 * default (alineado con Claude Code / OpenCode); bajalo con MYAGENT_MAX_TURNS
 * si querés un presupuesto estricto. El anti-bucle real está una línea abajo.
 */
export const MAX_TURNS = Number(process.env.MYAGENT_MAX_TURNS) || Number.MAX_SAFE_INTEGER;

/** Repeticiones idénticas de tool-calls seguidas antes de cortar el bucle. */
export const MAX_IDENTICAL_TOOL_TURNS = 3;

// ── Snapshots por sesión (edit/hashline/snapshot-store.ts) ───────────────────

/** Versiones retenidas por archivo en el SnapshotStore. */
export const MAX_SNAPSHOT_VERSIONS_PER_PATH = 4; // como oh-my-pi

/** Cantidad máxima de archivos con snapshot por sesión. */
export const MAX_SNAPSHOT_PATHS = 30;
