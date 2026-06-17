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

// ── Agent loop (engine/loop.ts) ──────────────────────────────────────────────

/** Tope de turnos para evitar bucles infinitos de tool-calling. */
export const MAX_TURNS = 25;

/** Repeticiones idénticas de tool-calls seguidas antes de cortar el bucle. */
export const MAX_IDENTICAL_TOOL_TURNS = 3;

// ── Snapshots por sesión (edit/hashline/snapshot-store.ts) ───────────────────

/** Versiones retenidas por archivo en el SnapshotStore. */
export const MAX_SNAPSHOT_VERSIONS_PER_PATH = 4; // como oh-my-pi

/** Cantidad máxima de archivos con snapshot por sesión. */
export const MAX_SNAPSHOT_PATHS = 30;
