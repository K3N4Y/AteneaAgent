// Una burbuja de mensaje. El usuario se muestra como texto plano; el asistente
// se renderiza como markdown e incluye las tarjetas de herramientas del turno.

import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import type { Message, ThinkingSegment } from "../state/session";
import { thinkingSegments } from "../state/session";
import { ToolCallCard } from "./ToolCallCard";
import { PlanView } from "./PlanView";
import { ThinkingBlock } from "./ThinkingBlock";
import { useSmoothText } from "./useSmoothText";

function MarkdownChunk({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {text}
    </Markdown>
  );
}

/** Ancla cronológica de la tool, acotada al largo del texto (legacy → al final). */
function offsetOf(call: { textOffset?: number }, max: number): number {
  return typeof call.textOffset === "number"
    ? Math.min(call.textOffset, max)
    : max;
}

export function MessageBubble({
  message,
  streaming,
}: {
  message: Message;
  streaming: boolean;
}) {
  const isAssistant = message.role === "assistant";
  const fullText = isAssistant ? message.text : "";
  const calls = isAssistant ? message.toolCalls : [];

  // El texto se parte en los puntos donde se invocó cada tool. El último tramo
  // (lo que se sigue escribiendo tras la última tool) es el "vivo": ese se anima
  // con useSmoothText; lo anterior ya está fijado y se muestra de una.
  const lastOffset = calls.length
    ? offsetOf(calls[calls.length - 1], fullText.length)
    : 0;
  // useSmoothText incondicional (regla de hooks). En user le pasamos "".
  const tail = useSmoothText(isAssistant ? fullText.slice(lastOffset) : "");

  // Tramos de razonamiento, anclados por cuántas tools los precedían (afterTools).
  const thinking = isAssistant ? thinkingSegments(message.thinking) : [];
  const lastSeg = thinking[thinking.length - 1];
  // El texto crudo tras la última tool: la respuesta en curso (sin suavizar, para
  // decidir al toque si el razonamiento ya colapsa o sigue "vivo").
  const rawTail = isAssistant ? fullText.slice(lastOffset) : "";

  // Un tramo está "terminal" si nada vino después: es el último, no entró ninguna
  // tool tras él (afterTools === total) y no hay respuesta en curso. Solo el
  // terminal puede latir (💭 mientras streamea) o, si el turno cerró sin texto,
  // quedar abierto (razonamiento-como-respuesta). El resto colapsa a su cabecera.
  function renderThinking(seg: ThinkingSegment, key: string): ReactNode {
    const terminal =
      seg === lastSeg && seg.afterTools === calls.length && !rawTail;
    return (
      <ThinkingBlock
        key={key}
        text={seg.text}
        live={terminal && streaming}
        hasAnswer={!terminal}
      />
    );
  }
  const thinkingAfter = (n: number, prefix: string): ReactNode[] =>
    thinking
      .filter((seg) => seg.afterTools === n)
      .map((seg, i) => renderThinking(seg, `${prefix}_${i}`));

  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-role">tú</div>
        <div className="msg-text">{message.text}</div>
      </div>
    );
  }

  // Intercala razonamiento, tramos de texto y tarjetas en orden cronológico:
  // pensar → (texto) → tool → volver a pensar → (texto) → tool → …
  const blocks: ReactNode[] = [];
  blocks.push(...thinkingAfter(0, "think0")); // razonamiento previo a toda tool
  let prev = 0;
  calls.forEach((c, i) => {
    const off = offsetOf(c, fullText.length);
    const chunk = fullText.slice(prev, off);
    if (chunk) blocks.push(<MarkdownChunk key={`t${i}`} text={chunk} />);
    blocks.push(<ToolCallCard key={c.id} call={c} />);
    blocks.push(...thinkingAfter(i + 1, `think${i + 1}`)); // razonamiento tras esta tool
    prev = off;
  });
  if (tail) blocks.push(<MarkdownChunk key="tail" text={tail} />);

  const empty = !fullText && calls.length === 0 && !message.plan;
  return (
    <div className="msg msg-assistant">
      <div className="msg-role">agente</div>
      <div className="msg-text markdown">
        {/* Los bloques de razonamiento van intercalados dentro de `blocks`, en su
            punto cronológico (no apilados arriba). Ver thinkingAfter() / blocks. */}
        {blocks}
        {message.plan && <PlanView plan={message.plan} />}
        {empty && streaming && <span className="cursor">▍</span>}
      </div>
    </div>
  );
}
