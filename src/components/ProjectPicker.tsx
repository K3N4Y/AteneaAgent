// Píldora de la topbar que muestra el proyecto activo; al click abre el modal de
// proyectos. El diálogo nativo de carpeta (pickProjectDir) vive acá y lo usan el
// modal y la lista de sesiones; fuera de Tauri (p. ej. `pnpm dev` en el
// navegador) cae a un prompt para poder seguir probando.

import { useSession } from "../state/session";

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

export function ProjectPicker({ onClick }: { onClick: () => void }) {
  const projectPath = useSession((s) => s.projectPath);

  return (
    <button
      type="button"
      className="project-pick"
      onClick={onClick}
      title={projectPath ?? "Elegir carpeta del proyecto"}
    >
      <span className="project-glyph">📁</span>
      <span className="project-name">{projectBasename(projectPath)}</span>
    </button>
  );
}
