// Selector de agente (Plan | Build | E2E). En Fase 0 cambia el system prompt y
// el set de herramientas en el motor; la UI rica de cada modo llega en Fase 1.

import { useSession } from "../state/session";
import type { AgentId } from "../transport/protocol";

const AGENTS: { id: AgentId; label: string; hint: string }[] = [
  { id: "plan", label: "Plan", hint: "solo lectura" },
  { id: "build", label: "Build", hint: "lee + escribe" },
  { id: "e2e", label: "E2E", hint: "crea todo" },
];

export function AgentSwitcher() {
  const agentId = useSession((s) => s.agentId);
  const setAgent = useSession((s) => s.setAgent);
  const streaming = useSession((s) => s.streaming);

  return (
    <div className="agent-switcher">
      {AGENTS.map((a) => (
        <button
          key={a.id}
          className={`agent-tab ${agentId === a.id ? "active" : ""} agent-${a.id}`}
          disabled={streaming}
          title={a.hint}
          onClick={() => setAgent(a.id)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
