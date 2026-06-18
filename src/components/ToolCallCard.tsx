// Tarjeta de una llamada a herramienta: nombre, argumentos y resultado/estado.
// Para edit_file/write_file y run_command el resultado se muestra rico e inline
// (diff coloreado / bloque de terminal); el resto cae en el <pre> genérico.

import { useState } from "react";
import type { UiToolCall } from "../state/session";
import { DiffView } from "./DiffView";
import { TerminalBlock } from "./TerminalBlock";

const DIFF_TOOLS = new Set(["edit_file", "write_file"]);
const TERMINAL_TOOLS = new Set(["run_command"]);

function summarizeInput(input: unknown): string {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.path === "string") return obj.path;
    if (typeof obj.command === "string") return obj.command;
    if (typeof obj.input === "string") return obj.input.split("\n")[0].slice(0, 80);
  }
  const s = JSON.stringify(input ?? {});
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

export function ToolCallCard({ call }: { call: UiToolCall }) {
  const [open, setOpen] = useState(false);
  const status = !call.done ? "run" : call.isError ? "err" : "ok";
  const badge = status === "run" ? "⏳" : status === "err" ? "✗" : "✓";

  // Vista rica inline (sólo en éxito; los errores son texto, no un diff/salida).
  const rich =
    call.done && !call.isError && call.output !== undefined
      ? DIFF_TOOLS.has(call.name)
        ? "diff"
        : TERMINAL_TOOLS.has(call.name)
          ? "terminal"
          : undefined
      : undefined;

  return (
    <div className={`tool-card tool-${status}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-badge">{badge}</span>
        <span className="tool-name">{call.name}</span>
        <span className="tool-arg">{summarizeInput(call.input)}</span>
        <span className="tool-toggle">{open ? "▾" : "▸"}</span>
      </button>

      {rich === "diff" && <DiffView output={call.output!} />}
      {rich === "terminal" && <TerminalBlock output={call.output!} />}
      {/* Errores siempre visibles, aunque la tarjeta esté plegada. */}
      {call.done && call.isError && <pre className="tool-error">{call.output}</pre>}

      {open && (
        <div className="tool-body">
          <div className="tool-section-label">input</div>
          <pre>{JSON.stringify(call.input, null, 2)}</pre>
          {/* Salida cruda sólo para tools sin vista rica (la rica ya la muestra). */}
          {call.done && !call.isError && !rich && (
            <>
              <div className="tool-section-label">output</div>
              <pre>{call.output}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
