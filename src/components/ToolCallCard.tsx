// Tarjeta de una llamada a herramienta: nombre, argumentos y resultado/estado.

import { useState } from "react";
import type { UiToolCall } from "../state/session";

function summarizeInput(input: unknown): string {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.path === "string") return obj.path;
    if (typeof obj.input === "string") return obj.input.split("\n")[0].slice(0, 80);
  }
  const s = JSON.stringify(input ?? {});
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

export function ToolCallCard({ call }: { call: UiToolCall }) {
  const [open, setOpen] = useState(false);
  const status = !call.done ? "run" : call.isError ? "err" : "ok";
  const badge = status === "run" ? "⏳" : status === "err" ? "✗" : "✓";

  return (
    <div className={`tool-card tool-${status}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-badge">{badge}</span>
        <span className="tool-name">{call.name}</span>
        <span className="tool-arg">{summarizeInput(call.input)}</span>
        <span className="tool-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="tool-body">
          <div className="tool-section-label">input</div>
          <pre>{JSON.stringify(call.input, null, 2)}</pre>
          {call.done && (
            <>
              <div className="tool-section-label">{call.isError ? "error" : "output"}</div>
              <pre>{call.output}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
