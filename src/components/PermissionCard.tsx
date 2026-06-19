// PermissionCard: confirmación humana antes de ejecutar un comando
// (run_command). Aparece inline al final del chat cuando el motor pide permiso;
// muestra el comando exacto y deja aprobar o rechazar. Sin esto, el comando no
// se ejecuta (principio de "control humano sobre lo irreversible").

import { useSession } from "../state/session";
import { respondPermission } from "../transport/client";

export function PermissionCard() {
  const pending = useSession((s) => s.pendingPermission);
  if (!pending) return null;

  return (
    <div className="perm-card">
      <div className="perm-head">⚠️ El agente quiere ejecutar un comando</div>
      <pre className="perm-command">
        {pending.cwd ? `${pending.cwd} $ ` : "$ "}
        {pending.command}
      </pre>
      <div className="perm-actions">
        <button
          type="button"
          className="perm-btn perm-deny"
          onClick={() => respondPermission(pending.id, false)}
        >
          Rechazar
        </button>
        <button
          type="button"
          className="perm-btn perm-approve"
          onClick={() => respondPermission(pending.id, true)}
        >
          Ejecutar
        </button>
      </div>
    </div>
  );
}
