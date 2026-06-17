// Selector de agente (Plan | Build | E2E). Cambia el system prompt y el set de
// herramientas en el motor. El modo activo muestra su capacidad junto a las
// pestañas para que sea claro qué puede hacer el agente en cada momento.

import { useSession } from "../state/session";
import type { AgentId } from "../transport/protocol";

const AGENTS: { id: AgentId; label: string; hint: string }[] = [
  { id: "plan", label: "Plan", hint: "sólo lee y propone un plan" },
  { id: "build", label: "Build", hint: "lee, edita y corre comandos" },
  { id: "e2e", label: "E2E", hint: "construye el proyecto entero" },
];

export function AgentSwitcher() {
  const agentId = useSession((s) => s.agentId);
  const setAgent = useSession((s) => s.setAgent);
  const streaming = useSession((s) => s.streaming);
  const active = AGENTS.find((a) => a.id === agentId);

  return (
    <>
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
      {active && <span className={`agent-hint agent-${active.id}`}>{active.hint}</span>}
    </>
  );
}
