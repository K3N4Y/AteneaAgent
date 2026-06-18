// Lista de sesiones guardadas (localStorage), agrupadas por carpeta de proyecto.
// Click retoma una; "+ Nueva" abre una vacía. Se re-renderiza cuando cambian los
// mensajes (un turno persiste) o la sesión activa; un contador local fuerza el
// refresco tras borrar.

import { useState } from "react";
import { listSessions, deleteSession, type StoredSession } from "../state/history";
import { useSession } from "../state/session";
import { resumeSession, startNewSession } from "../transport/client";

function rel(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "recién";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

// Nombre de la carpeta a partir de la ruta (último segmento). Sin ruta → null.
function folderName(path?: string): string | null {
  if (!path) return null;
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

interface Group {
  path?: string;
  label: string;
  sessions: StoredSession[];
}

// Proyectos colapsados (persistido). Clave = projectPath, o "" para "Sin proyecto".
const COLLAPSE_KEY = "myagent:historyCollapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
  } catch {
    // Cuota llena o storage no disponible: el estado vive solo en memoria.
  }
}

// Agrupa por projectPath preservando el orden por recencia (listSessions ya
// viene ordenado desc), así el proyecto usado más recientemente queda arriba.
function groupByProject(sessions: StoredSession[]): Group[] {
  const groups: Group[] = [];
  const byPath = new Map<string, Group>();
  for (const s of sessions) {
    const key = s.projectPath ?? "";
    let g = byPath.get(key);
    if (!g) {
      g = { path: s.projectPath, label: folderName(s.projectPath) ?? "Sin proyecto", sessions: [] };
      byPath.set(key, g);
      groups.push(g);
    }
    g.sessions.push(s);
  }
  return groups;
}

export function HistoryList() {
  const sessionId = useSession((s) => s.sessionId);
  useSession((s) => s.messages); // re-render al persistir un turno
  const [, force] = useState(0);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const groups = groupByProject(listSessions());

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      saveCollapsed(next);
      return next;
    });
  }

  return (
    <div className="history">
      <button className="history-new" onClick={startNewSession}>
        + Nueva sesión
      </button>
      {groups.length === 0 && <div className="tree-empty">Sin sesiones guardadas.</div>}
      {groups.map((g) => {
        const key = g.path ?? "";
        const isCollapsed = collapsed.has(key);
        return (
          <div key={key} className="history-group">
            <button
              className="history-group-label"
              title={g.path ?? g.label}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(key)}
            >
              <span className={`history-caret ${isCollapsed ? "collapsed" : ""}`}>▾</span>
              <span className="history-group-name">{g.label}</span>
              <span className="history-group-count">{g.sessions.length}</span>
            </button>
            {!isCollapsed &&
              g.sessions.map((s) => (
            <div key={s.id} className={`history-item ${s.id === sessionId ? "active" : ""}`}>
              <button className="history-open" onClick={() => resumeSession(s)} title={s.title}>
                <span className="history-title">{s.title}</span>
                <span className="history-time">{rel(s.updatedAt)}</span>
              </button>
              <button
                className="history-del"
                title="Eliminar"
                aria-label="Eliminar sesión"
                onClick={() => {
                  deleteSession(s.id);
                  force((n) => n + 1);
                }}
              >
                ×
              </button>
            </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
