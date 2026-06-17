// Una burbuja de mensaje. El usuario se muestra como texto plano; el asistente
// se renderiza como markdown e incluye las tarjetas de herramientas del turno.

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { Message } from "../state/session";
import { ToolCallCard } from "./ToolCallCard";
import { PlanView } from "./PlanView";

export function MessageBubble({ message, streaming }: { message: Message; streaming: boolean }) {
  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-role">tú</div>
        <div className="msg-text">{message.text}</div>
      </div>
    );
  }

  const empty = !message.text && message.toolCalls.length === 0 && !message.plan;
  return (
    <div className="msg msg-assistant">
      <div className="msg-role">agente</div>
      <div className="msg-text markdown">
        {message.text && (
          <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
        )}
        {message.toolCalls.map((c) => (
          <ToolCallCard key={c.id} call={c} />
        ))}
        {message.plan && <PlanView plan={message.plan} />}
        {empty && streaming && <span className="cursor">▍</span>}
      </div>
    </div>
  );
}
