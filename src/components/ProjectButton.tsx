// Botón de proyecto que vive arriba del composer. Muestra el proyecto activo y
// al click abre el modal de proyectos (elegir uno ya abierto o abrir uno nuevo).

import { useSession } from "../state/session";
import { projectBasename } from "./ProjectPicker";
import { ChevronIcon } from "./icons";

export function ProjectButton({ onClick }: { onClick: () => void }) {
  const projectPath = useSession((s) => s.projectPath);

  return (
    <button
      type="button"
      className="project-bar"
      onClick={onClick}
      title={projectPath ?? "Elegir proyecto"}
    >
      <span className="project-glyph">📁</span>
      <span className="project-bar-name">{projectBasename(projectPath)}</span>
      <ChevronIcon />
    </button>
  );
}
