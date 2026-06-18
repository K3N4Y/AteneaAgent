// El agent loop: un ÚNICO bucle que sirve para cualquier proveedor. Pide un
// turno vía LlmProvider.stream, ejecuta las tools que el modelo pida y le
// devuelve los resultados, hasta que termina. Es el punto natural para aplicar
// permisos (Fase 1) de forma uniforme, sin importar el proveedor.

import { getProvider } from "../providers/registry";
import type { ContentPart, LlmMessage } from "../providers/types";
import { toToolSpec, type Tool, type ToolContext } from "../tools/types";
import { MAX_TURNS, MAX_IDENTICAL_TOOL_TURNS } from "../config/limits";
import type { EmitFn } from "./events";

export interface RunOptions {
  providerId: string;
  model: string;
  system: string;
  /** Historial de la sesión: el loop le agrega assistant + tool_result. */
  messages: LlmMessage[];
  tools: Tool[];
  ctx: ToolContext;
  signal?: AbortSignal;
}

export async function runAgent(opts: RunOptions, emit: EmitFn): Promise<void> {
  const provider = getProvider(opts.providerId);
  const toolSpecs = opts.tools.map(toToolSpec);
  const messages = opts.messages;

  let lastToolSig = "";
  let sameToolTurns = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (opts.signal?.aborted) {
      emit({ type: "error", message: "Turno cancelado." });
      return;
    }

    const assistantParts: ContentPart[] = [];
    const calls: { id: string; name: string; input: unknown }[] = [];
    let usage: unknown;
    let failed = false;

    for await (const ev of provider.stream(
      {
        model: opts.model,
        system: opts.system,
        messages,
        tools: toolSpecs,
      },
      opts.signal,
    )) {
      if (ev.type === "text_delta") {
        emit({ type: "assistant_delta", text: ev.text });
        assistantParts.push({ type: "text", text: ev.text });
      } else if (ev.type === "thinking_delta") {
        emit({ type: "thinking_delta", text: ev.text });
      } else if (ev.type === "tool_call") {
        calls.push({ id: ev.id, name: ev.name, input: ev.input });
        assistantParts.push({ type: "tool_use", id: ev.id, name: ev.name, input: ev.input });
      } else if (ev.type === "done") {
        usage = ev.usage;
      } else if (ev.type === "error") {
        emit({ type: "error", message: ev.message });
        failed = true;
      }
    }

    if (failed) {
      // El stream cortó mid-flight. Preservamos el texto parcial ya emitido
      // empujándolo al historial: así el próximo turno conserva el contexto y
      // la UI no lo pierde. Sólo guardamos las partes de texto —en un error
      // mid-stream las tool_use quedan incompletas (sin tool_result que las
      // acompañe) y persistirlas rompería el siguiente request.
      const partialText = assistantParts.filter((p) => p.type === "text");
      if (partialText.length > 0) {
        messages.push({ role: "assistant", content: partialText });
      }
      return;
    }

    // Registrar el turno del asistente en el historial (aunque sólo sean tools).
    if (assistantParts.length > 0) {
      messages.push({ role: "assistant", content: assistantParts });
    }

    if (calls.length === 0) {
      emit({ type: "done", usage });
      return;
    }

    // Ejecutar las tools pedidas y devolver los resultados como mensaje user.
    const resultParts: ContentPart[] = [];
    for (const call of calls) {
      emit({ type: "tool_call", id: call.id, name: call.name, input: call.input });
      const { output, isError } = await runTool(opts.tools, call, opts.ctx);
      // ponytail: read_file vuelca el archivo entero; el LLM lo necesita pero el
      // frontend sólo muestra qué se leyó. Recortamos sólo el evento de UI.
      const uiOutput =
        call.name === "read_file" && !isError
          ? `Leído ${(call.input as { path?: string })?.path ?? ""}`.trim()
          : output;
      emit({ type: "tool_result", id: call.id, name: call.name, output: uiOutput, isError });
      resultParts.push({ type: "tool_result", toolUseId: call.id, output, isError });
    }
    messages.push({ role: "user", content: resultParts });

    // Cortafuegos anti-bucle: detectado DESPUÉS de ejecutar las tools (el
    // historial queda consistente: assistant tool_use + user tool_result) y
    // antes de pedir otro turno al LLM, así no seguimos quemando presupuesto.
    const sig = signatureOf(calls);
    sameToolTurns = sig === lastToolSig ? sameToolTurns + 1 : 1;
    lastToolSig = sig;
    if (sameToolTurns >= MAX_IDENTICAL_TOOL_TURNS) {
      emit({
        type: "error",
        message:
          `El modelo repitió la misma operación ${sameToolTurns} veces seguidas; ` +
          `corto el bucle para no agotar el presupuesto.`,
      });
      return;
    }
  }

  emit({
    type: "error",
    message: `Se alcanzó el tope de ${MAX_TURNS} turnos sin terminar.`,
  });
}

/** Firma estable de un conjunto de tool-calls, para detectar repeticiones. */
function signatureOf(calls: { name: string; input: unknown }[]): string {
  return calls
    .map((c) => `${c.name}(${JSON.stringify(c.input)})`)
    .sort()
    .join("|");
}

async function runTool(
  tools: Tool[],
  call: { name: string; input: unknown },
  ctx: ToolContext,
): Promise<{ output: string; isError: boolean }> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    return { output: `Herramienta desconocida: ${call.name}`, isError: true };
  }

  // Validación con Zod del input del modelo.
  const parsed = tool.schema.safeParse(call.input);
  if (!parsed.success) {
    return {
      output: `Input inválido para ${call.name}: ${parsed.error.message}`,
      isError: true,
    };
  }

  try {
    return await tool.run(parsed.data, ctx);
  } catch (err) {
    // Un throw inesperado en la tool se reporta como resultado, no mata el loop.
    return { output: `Error en ${call.name}: ${(err as Error).message}`, isError: true };
  }
}
