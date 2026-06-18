// Selector de carpeta del proyecto activo (píldora en la topbar). Usa el diálogo
// nativo de Tauri (@tauri-apps/plugin-dialog); fuera de Tauri (p. ej. `pnpm dev`
// en el navegador) cae a un prompt para poder seguir probando.

import { useSession } from "../state/session";

function basename(p?: string): string {
  if (!p) return "Elegir proyecto";
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export function ProjectPicker() {
  const projectPath = useSession((s) => s.projectPath);
  const setProjectPath = useSession((s) => s.setProjectPath);

  const pick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false, defaultPath: projectPath });
      if (typeof dir === "string") setProjectPath(dir);
    } catch {
      const manual = window.prompt("Ruta absoluta del proyecto:", projectPath ?? "");
      if (manual && manual.trim()) setProjectPath(manual.trim());
    }
  };

  return (
    <button type="button" className="project-pick" onClick={pick} title={projectPath ?? "Elegir carpeta del proyecto"}>
      <span className="project-glyph">📁</span>
      <span className="project-name">{basename(projectPath)}</span>
    </button>
  );
}
