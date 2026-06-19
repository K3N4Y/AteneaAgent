// Diálogo nativo de carpeta + helper de nombre de proyecto. Viven fuera del
// componente ProjectPicker para no romper Fast Refresh (un archivo de componente
// debería exportar sólo componentes). Los usan ProjectPicker, ProjectButton, el
// modal de proyectos y la lista de sesiones.

/** Nombre de la carpeta a partir de la ruta. Sin ruta → "Elegir proyecto". */
export function projectBasename(p?: string): string {
  if (!p) return "Elegir proyecto";
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Abre el diálogo nativo de carpeta (con fallback a prompt fuera de Tauri).
 * Devuelve la ruta elegida o null si se cancela. Reutilizable desde el modal
 * de proyectos y la lista de sesiones. */
export async function pickProjectDir(current?: string): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({
      directory: true,
      multiple: false,
      defaultPath: current,
    });
    return typeof dir === "string" ? dir : null;
  } catch {
    const manual = window.prompt("Ruta absoluta del proyecto:", current ?? "");
    return manual && manual.trim() ? manual.trim() : null;
  }
}
