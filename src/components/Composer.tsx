// Input de texto + enviar. Bloquea mientras el agente trabaja (streaming).

import { useState } from "react";
import { useSession } from "../state/session";
import { sendUserMessage } from "../transport/client";

export function Composer() {
  const [text, setText] = useState("");
  const streaming = useSession((s) => s.streaming);
  const connected = useSession((s) => s.connected);
  const disabled = streaming || !connected;

  const submit = () => {
    if (disabled || !text.trim()) return;
    sendUserMessage(text);
    setText("");
  };

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        placeholder={connected ? "Escribí un mensaje…  (Enter para enviar)" : "Conectando al motor…"}
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
      <button className="composer-send" onClick={submit} disabled={disabled || !text.trim()}>
        {streaming ? "…" : "Enviar"}
      </button>
    </div>
  );
}
