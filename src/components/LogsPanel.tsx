// Consola de desarrollo acoplada al pie de la app. Muestra el tráfico crudo con
// el sidecar (lo que alimenta transport/client.ts) para diagnosticar por qué el
// agente no responde: conexión, mensajes salientes, eventos entrantes y errores.

import { useEffect, useRef } from "react";

import { useSession, type LogEntry } from "../state/session";

export function LogsPanel({ onClose }: { onClose: () => void }) {
  const logs = useSession((s) => s.logs);
  const clearLogs = useSession((s) => s.clearLogs);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Autoscroll al final cuando llega una entrada nueva.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);

  return (
    <section className="logs-panel">
      <div className="logs-head">
        <span className="logs-title">Logs de desarrollo</span>
        <span className="logs-count">{logs.length}</span>
        <div className="logs-actions">
          <button className="logs-btn" onClick={clearLogs}>
            Limpiar
          </button>
          <button className="logs-btn" onClick={onClose} aria-label="Cerrar logs">
            ✕
          </button>
        </div>
      </div>
      <div className="logs-body">
        {logs.length === 0 ? (
          <div className="logs-empty">
            Sin eventos todavía. Mandá un mensaje para ver el tráfico con el sidecar.
          </div>
        ) : (
          logs.map((l) => <LogRow key={l.id} log={l} />)
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}

function LogRow({ log }: { log: LogEntry }) {
  const arrow = log.dir === "in" ? "←" : log.dir === "out" ? "→" : "•";
  const cls = `logs-row logs-${log.dir}${log.level === "error" ? " logs-error" : ""}`;
  return (
    <div className={cls}>
      <span className="logs-time">{fmtTime(log.ts)}</span>
      <span className="logs-arrow">{arrow}</span>
      {log.detail ? (
        <details className="logs-detail">
          <summary className="logs-text">{log.text}</summary>
          <pre>{log.detail}</pre>
        </details>
      ) : (
        <span className="logs-text">{log.text}</span>
      )}
    </div>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hms = d.toLocaleTimeString("es", { hour12: false });
  return `${hms}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
