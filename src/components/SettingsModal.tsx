// Modal de configuración: proveedor, modelo y API key. Persiste en localStorage
// y empuja un mensaje `set_config` al sidecar al guardar.

import { useEffect, useState } from "react";

import { useSession } from "../state/session";
import { sendSetConfig } from "../transport/client";

// ponytail: la lista de proveedores conocidos vive en la UI. Si el sidecar
// registra uno nuevo, agregalo acá. La fuente de verdad sigue siendo el
// registry del sidecar (server.ts valida el id al recibir set_config).
const PROVIDERS: { id: string; label: string; hint: string }[] = [
  { id: "opencode", label: "OpenCode Zen", hint: "pago por uso" },
  { id: "opencode-go", label: "OpenCode Go", hint: "suscripción mensual" },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const currentProvider = useSession((s) => s.providerId) ?? "opencode";
  const currentModel = useSession((s) => s.model) ?? "";

  const [providerId, setProviderId] = useState(currentProvider);
  const [model, setModel] = useState(currentModel);
  const [apiKey, setApiKey] = useState("");

  // Al abrir, o al cambiar de proveedor, carga la key guardada para ese
  // proveedor (cada provider tiene su propia key independiente).
  useEffect(() => {
    setApiKey(localStorage.getItem(`myagent:apiKey:${providerId}`) ?? "");
  }, [providerId]);

  const save = () => {
    if (!model.trim()) return;
    sendSetConfig(providerId, model.trim(), apiKey.trim());
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Configuración</div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <label className="modal-field">
          <span className="modal-label">Proveedor</span>
          <select
            className="modal-input"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.hint}
              </option>
            ))}
          </select>
        </label>

        <label className="modal-field">
          <span className="modal-label">Modelo</span>
          <input
            className="modal-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="p. ej. gpt-5.5, minimax-m2.5-free"
            autoFocus
          />
        </label>

        <label className="modal-field">
          <span className="modal-label">API key</span>
          <input
            className="modal-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Dejá vacío para usar la variable de entorno"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="modal-hint">
            Se guarda sólo en este navegador (localStorage). No se envía a
            ningún servidor remoto.
          </span>
        </label>

        <div className="modal-actions">
          <button className="modal-btn modal-btn-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="modal-btn modal-btn-save"
            onClick={save}
            disabled={!model.trim()}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
