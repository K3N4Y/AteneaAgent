// Lista de mensajes con auto-scroll al final mientras llega el stream.

import { useEffect, useRef } from "react";
import { useSession } from "../state/session";
import { MessageBubble } from "./MessageBubble";

export function ChatPanel() {
  const messages = useSession((s) => s.messages);
  const streaming = useSession((s) => s.streaming);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  return (
    <div className="chat-panel">
      {messages.length === 0 && (
        <div className="empty-hint">
          <p>Pedile al agente que lea o cree un archivo del proyecto.</p>
          <p className="empty-sub">
            p. ej. <code>lee docs/vision.md y resumilo</code>
          </p>
        </div>
      )}
      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} streaming={streaming} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
