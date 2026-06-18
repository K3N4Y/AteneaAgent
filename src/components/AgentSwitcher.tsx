// Selector de agente (Plan | Build | E2E) como píldora desplegable estilo Cursor.
// Vive dentro del composer: muestra el modo activo y, al abrir, despliega hacia
// arriba un menú con cada modo y su capacidad. Cambia el system prompt y el set
// de herramientas del motor al seleccionar.

import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { useSession } from "../state/session";
import type { AgentId } from "../transport/protocol";
import {
  CheckIcon,
  ChevronIcon,
  LayersIcon,
  PlanIcon,
  TerminalIcon,
} from "./icons";

const AGENTS: { id: AgentId; label: string; hint: string; Icon: FC }[] = [
  {
    id: "plan",
    label: "Plan",
    hint: "sólo lee y propone un plan",
    Icon: PlanIcon,
  },
  {
    id: "build",
    label: "Build",
    hint: "lee, edita y corre comandos",
    Icon: TerminalIcon,
  },
  {
    id: "e2e",
    label: "E2E",
    hint: "construye el proyecto entero",
    Icon: LayersIcon,
  },
];

export function AgentSwitcher() {
  const agentId = useSession((s) => s.agentId);
  const setAgent = useSession((s) => s.setAgent);
  const streaming = useSession((s) => s.streaming);
  const active = AGENTS.find((a) => a.id === agentId) ?? AGENTS[1];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic afuera o con Escape mientras el menú está abierto.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="agent-picker" ref={ref}>
      <button
        type="button"
        className={`composer-pill agent-pill agent-${active.id}`}
        disabled={streaming}
        title={active.hint}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agent-glyph">
          <active.Icon />
        </span>
        <span className="composer-pill-label">{active.label}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="agent-menu" role="menu">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitemradio"
              aria-checked={a.id === agentId}
              title={a.hint}
              className={`agent-menu-item agent-${a.id} ${a.id === agentId ? "active" : ""}`}
              onClick={() => {
                setAgent(a.id);
                setOpen(false);
              }}
            >
              <span className="agent-menu-icon">
                <a.Icon />
              </span>
              <span className="agent-menu-label">{a.label}</span>
              {a.id === agentId && (
                <span className="agent-menu-check">
                  <CheckIcon />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
