// Píldora de la topbar que muestra el proyecto activo; al click abre el modal de
// proyectos. El diálogo nativo de carpeta y el helper de nombre viven en
// ./projectDir (no en este archivo de componente, para no romper Fast Refresh).

import { useSession } from "../state/session";
import { projectBasename } from "./projectDir";

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
