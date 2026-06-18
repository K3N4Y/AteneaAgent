// Una burbuja de mensaje. El usuario se muestra como texto plano; el asistente
// se renderiza como markdown e incluye las tarjetas de herramientas del turno.

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import type { Message } from "../state/session";
import { ToolCallCard } from "./ToolCallCard";
import { PlanView } from "./PlanView";
import { ThinkingBlock } from "./ThinkingBlock";
import { useSmoothText } from "./useSmoothText";

export function MessageBubble({ message, streaming }: { message: Message; streaming: boolean }) {
  // useSmoothText incondicional (regla de hooks). En user no se usa: su texto va
  // plano y completo por la rama de abajo; le pasamos "" para no animar nada.
  const text = useSmoothText(message.role === "assistant" ? message.text : "");

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
        {/* ponytail: live = sigue pensando si streamea y aún no hay respuesta.
            hasAnswer evita esconder la respuesta cuando vino por reasoning. */}
        {message.thinking && (
          <ThinkingBlock
            text={message.thinking}
            live={streaming && !message.text}
            hasAnswer={!!message.text}
          />
        )}
        {text && (
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {text}
          </Markdown>
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
