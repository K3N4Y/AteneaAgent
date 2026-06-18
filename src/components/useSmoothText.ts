// Smooth streaming: separa la velocidad de red de la velocidad visual. El texto
// ya acumulado (`target`) se revela carácter a carácter a ritmo parejo con rAF,
// dando el efecto máquina-de-escribir sin tocar transporte ni store.
//
// ponytail: avance proporcional al texto pendiente (ease-out) en vez de ms/char
// fijo del blog → se autolimita el retraso, nunca queda una cola larga al final.
// Techo: depende de la tasa de frames (≈2x en 120 Hz); da igual, es cosmético.

import { useEffect, useRef, useState } from "react";

// Núcleo puro: cuánto avanzar el índice de revelado en un frame.
export function nextIndex(idx: number, len: number, factor = 0.2): number {
  if (idx >= len) return idx;
  return Math.min(len, idx + Math.max(1, Math.ceil((len - idx) * factor)));
}

export function useSmoothText(target: string): string {
  // idx arranca en el largo actual: lo ya presente al montar (historial/resume)
  // se muestra de una; sólo se revela lo que llega después. En vivo el mensaje
  // monta vacío (startUserTurn empuja text:"") → idx=0 → se revela todo.
  const [shown, setShown] = useState(target);
  const idxRef = useRef(target.length);

  // Un único efecto por valor de `target`: el cleanup de React cancela el frame
  // en vuelo y el siguiente run reprograma desde idxRef. Sin refs-guard que se
  // traben en el doble-montaje de StrictMode.
  useEffect(() => {
    if (target.length < idxRef.current) {
      // target más corto (mensaje nuevo/reset) → saltar
      idxRef.current = target.length;
      setShown(target);
    }
    if (idxRef.current >= target.length) return; // nada pendiente → sin rAF

    let raf = 0;
    const tick = () => {
      if (idxRef.current >= target.length) return; // alcanzado: parar
      idxRef.current = nextIndex(idxRef.current, target.length);
      setShown(target.slice(0, idxRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return shown;
}
