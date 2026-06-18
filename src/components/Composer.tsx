// Composer estilo Cursor: una tarjeta redondeada con el textarea arriba y una
// barra inferior con el selector de agente + el modelo a la izquierda y los
// accesos de adjuntar/voz (placeholders) más el botón de enviar a la derecha.
// Bloquea el envío mientras el agente trabaja (streaming) o si no hay conexión.

import { useEffect, useState } from "react";
import { useSession } from "../state/session";
import { sendUserMessage } from "../transport/client";
import { AgentSwitcher } from "./AgentSwitcher";
import { ChevronIcon, MicIcon, PaperclipIcon, SendIcon } from "./icons";

export function Composer({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [text, setText] = useState("");
  const streaming = useSession((s) => s.streaming);
  const connected = useSession((s) => s.connected);
  const model = useSession((s) => s.model);
  const pendingInsert = useSession((s) => s.pendingInsert);
  const consumeInsert = useSession((s) => s.consumeInsert);
  const disabled = streaming || !connected;
  const canSend = !disabled && text.trim().length > 0;

  // Inserción desde el árbol de archivos: anexa el texto pedido y lo consume.
  useEffect(() => {
    if (!pendingInsert) return;
    setText((t) => (t ? `${t} ${pendingInsert}` : pendingInsert));
    consumeInsert();
  }, [pendingInsert, consumeInsert]);

  const submit = () => {
    if (!canSend) return;
    sendUserMessage(text);
    setText("");
  };

  return (
    <div className={`composer ${disabled ? "is-disabled" : ""}`}>
      <textarea
        className="composer-input"
        placeholder={connected ? "Escribí un mensaje al agente…" : "Conectando al motor…"}
        value={text}
        disabled={disabled}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />

      <div className="composer-bar">
        <div className="composer-bar-left">
          <AgentSwitcher />
          <button
            type="button"
            className="composer-pill composer-model"
            onClick={onOpenSettings}
            title="Cambiar modelo / proveedor"
          >
            <span className="composer-pill-label">{model ?? "modelo"}</span>
            <ChevronIcon />
          </button>
        </div>

        <div className="composer-bar-right">
          {/* Placeholders: adjuntar imagen y entrada de voz (todavía sin función). */}
          <button
            type="button"
            className="composer-icon"
            title="Adjuntar imagen (próximamente)"
            aria-label="Adjuntar imagen"
          >
            <PaperclipIcon />
          </button>
          <button
            type="button"
            className="composer-icon"
            title="Entrada de voz (próximamente)"
            aria-label="Entrada de voz"
          >
            <MicIcon />
          </button>
          {(streaming || text.trim().length > 0) && (
            <button
              type="button"
              className="composer-send"
              onClick={submit}
              disabled={!canSend}
              title="Enviar (Enter)"
              aria-label="Enviar mensaje"
            >
              {streaming ? <span className="composer-spinner" /> : <SendIcon />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
