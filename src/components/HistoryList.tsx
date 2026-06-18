// Lista de sesiones guardadas (localStorage). Click retoma una; "+ Nueva" abre
// una vacía. Se re-renderiza cuando cambian los mensajes (un turno persiste) o
// la sesión activa; un contador local fuerza el refresco tras borrar.

import { useState } from "react";
import { listSessions, deleteSession } from "../state/history";
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

export function HistoryList() {
  const sessionId = useSession((s) => s.sessionId);
  useSession((s) => s.messages); // re-render al persistir un turno
  const [, force] = useState(0);
  const sessions = listSessions();

  return (
    <div className="history">
      <button className="history-new" onClick={startNewSession}>
        + Nueva sesión
      </button>
      {sessions.length === 0 && <div className="tree-empty">Sin sesiones guardadas.</div>}
      {sessions.map((s) => (
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
}
