// Razonamiento del agente, estilo Cursor: mientras piensa (`live`) se ven en
// vivo las últimas líneas con un fade arriba; al empezar la respuesta el bloque
// se colapsa a su cabecera y un click lo reabre completo.
//
// ponytail: algunos modelos (deepseek-v4-flash vía Zen) a veces mandan TODA la
// respuesta por `reasoning_content` y dejan `content` vacío. En ese caso el
// razonamiento ES la respuesta: si el turno terminó sin texto (`!hasAnswer`),
// no colapsamos —dejamos el bloque abierto— para no esconder lo único que hay.

import { useEffect, useRef, useState } from "react";
import { useSmoothText } from "./useSmoothText";

export function ThinkingBlock({
  text: rawText,
  live,
  hasAnswer,
}: {
  text: string;
  live: boolean;
  hasAnswer: boolean;
}) {
  const text = useSmoothText(rawText);
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Peek en vivo: mantener el scroll al fondo para mostrar lo más reciente.
  const peek = live && !open;
  useEffect(() => {
    if (peek && bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, peek]);

  // Razonamiento-sin-respuesta: terminó (no live) y no hubo texto → mostrar todo.
  const forceFull = !live && !hasAnswer;
  const showFull = open || forceFull;
  const showBody = showFull || peek;

  return (
    <div className="think-card">
      <button
        type="button"
        className="think-head"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="think-badge">{live ? "💭" : "✓"}</span>
        <span className="think-name">
          {live ? "Pensando…" : "Razonamiento"}
        </span>
        <span className="tool-toggle">{showFull ? "▾" : "▸"}</span>
      </button>
      {showBody && (
        <div
          ref={bodyRef}
          className={`think-body ${showFull ? "think-full" : "think-peek"}`}
        >
          {text}
        </div>
      )}
    </div>
  );
}
