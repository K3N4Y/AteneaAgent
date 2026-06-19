// PlanView: la tarjeta del plan que emite el agente Plan (evento `plan`). Lo
// renderiza en markdown y ofrece "Aprobar", que cambia al agente Build y le
// pide implementar el plan (ver transport/client.ts → approvePlan).

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { UiPlan } from "../state/session";
import { useSession } from "../state/session";
import { approvePlan } from "../transport/client";

export function PlanView({ plan }: { plan: UiPlan }) {
  // Mientras el turno sigue activo el motor está "ocupado": aprobar dispararía
  // un mensaje nuevo que rebotaría. Se habilita al terminar el turno.
  const streaming = useSession((s) => s.streaming);
  const label = plan.approved
    ? "Aprobado"
    : streaming
      ? "Esperá a que termine…"
      : "Aprobar y construir";

  return (
    <div className={`plan-view ${plan.approved ? "approved" : ""}`}>
      <div className="plan-head">
        <span className="plan-title">📋 Plan propuesto</span>
        {plan.approved && <span className="plan-approved-tag">aprobado ✓</span>}
      </div>
      <div className="plan-body markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{plan.markdown}</Markdown>
      </div>
      <div className="plan-actions">
        <button
          type="button"
          className="plan-approve"
          disabled={plan.approved || streaming}
          onClick={() => approvePlan()}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
