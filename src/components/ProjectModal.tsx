// Modal para cambiar de proyecto: lista los proyectos ya abiertos (derivados del
// historial de sesiones, más el activo) o abre uno nuevo con el diálogo nativo.
// Elegir un proyecto cambia el proyecto de trabajo y abre una sesión nueva en él.

import { listSessions } from "../state/history";
import { useSession } from "../state/session";
import { openProject } from "../transport/client";
import { pickProjectDir, projectBasename } from "./ProjectPicker";

interface Known {
  path: string;
  label: string;
  count: number;
}

// Proyectos conocidos = rutas únicas del historial (orden por recencia, porque
// listSessions ya viene ordenado desc), más el activo si aún no tiene sesiones.
function knownProjects(current?: string): Known[] {
  const map = new Map<string, Known>();
  for (const s of listSessions()) {
    if (!s.projectPath) continue;
    const k = map.get(s.projectPath) ?? {
      path: s.projectPath,
      label: projectBasename(s.projectPath),
      count: 0,
    };
    k.count++;
    map.set(s.projectPath, k);
  }
  if (current && !map.has(current)) {
    map.set(current, {
      path: current,
      label: projectBasename(current),
      count: 0,
    });
  }
  return [...map.values()];
}

export function ProjectModal({ onClose }: { onClose: () => void }) {
  const current = useSession((s) => s.projectPath);
  const projects = knownProjects(current);

  const choose = (path: string) => {
    if (path !== current) openProject(path);
    onClose();
  };

  const openNew = async () => {
    const dir = await pickProjectDir(current);
    if (dir) openProject(dir);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Proyectos</div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="project-list">
          {projects.length === 0 && (
            <div className="modal-hint">
              Todavía no abriste ningún proyecto.
            </div>
          )}
          {projects.map((p) => (
            <button
              key={p.path}
              className={`project-row ${p.path === current ? "active" : ""}`}
              onClick={() => choose(p.path)}
              title={p.path}
            >
              <span className="project-glyph">📁</span>
              <span className="project-row-name">{p.label}</span>
              {p.count > 0 && (
                <span className="project-row-count">{p.count}</span>
              )}
            </button>
          ))}
        </div>

        <button
          className="modal-btn modal-btn-save project-open-new"
          onClick={openNew}
        >
          + Abrir nuevo proyecto…
        </button>
      </div>
    </div>
  );
}
