// task: lanza SUBAGENTES con contexto aislado y recibe de vuelta sólo un
// resumen. Resuelve dos cosas: aislamiento de contexto (una exploración que lee
// 20 archivos quema su presupuesto en el subagente; al padre vuelven 10 líneas)
// y paralelismo (varias sub-tareas independientes corren a la vez). La tool en
// sí es trivial: valida, mapea cada sub-tarea a ctx.spawnSubagent y combina. El
// motor (server.ts) hace el trabajo pesado de spawnear.

import { z } from "zod";

import { type Tool, type ToolResult } from "./types";
import { MAX_SUBAGENTS_PER_CALL } from "../config/limits";

const oneTask = z.object({
  subagent_type: z
    .enum(["explore", "build"])
    .describe(
      "explore: sólo lectura (read_file/list_dir/search), para investigar y resumir. " +
        "build: lectura + escritura + run_command, para implementar una sub-tarea acotada.",
    ),
  description: z
    .string()
    .min(1)
    .describe(
      "Instrucción AUTÓNOMA y completa para el subagente: qué investigar o hacer y " +
        "qué devolver. El subagente NO ve la conversación del padre, sólo este texto.",
    ),
});

const schema = z.object({
  tasks: z
    .array(oneTask)
    .min(1)
    .max(MAX_SUBAGENTS_PER_CALL)
    .describe(
      "Una o más sub-tareas. Si pasás varias, corren EN PARALELO y se devuelven " +
        "todas juntas. Usá varias sólo cuando son independientes entre sí.",
    ),
});

export const taskTool: Tool<z.infer<typeof schema>> = {
  name: "task",
  description:
    "Delega trabajo en SUBAGENTES con contexto aislado. Cada subagente arranca SIN " +
    "contexto (sólo ve la `description` que le pasás) y te devuelve un RESUMEN, no su " +
    "transcript completo: ideal para no quemar tu propio contexto en exploraciones " +
    "amplias. `explore` (default seguro) es sólo lectura; `build` puede escribir y " +
    "correr comandos para una sub-tarea acotada. Si pasás varias tasks corren en " +
    "PARALELO: usalo SÓLO con tasks independientes y, en paralelo, preferí `explore` " +
    "(dos `build` a la vez pueden pisarse el mismo archivo). Reservalo para trabajo " +
    "que vale el costo (investigación amplia, fan-out), no para una sola lectura " +
    "(para eso está read_file directo).",
  schema,
  async run({ tasks }, ctx): Promise<ToolResult> {
    if (!ctx.spawnSubagent) {
      return {
        output: "No hay orquestador de subagentes en este contexto.",
        isError: true,
      };
    }
    const spawn = ctx.spawnSubagent;
    // parentToolId real lo estampa el server vía scopedEmit; acá pasamos uno por
    // task sólo para distinguirlas si hubiera varias (la UI ya las agrupa por la
    // tool-call `task` que el loop emitió antes de invocarnos).
    const results = await Promise.all(
      tasks.map((t) =>
        spawn({
          subagentType: t.subagent_type,
          prompt: t.description,
          parentToolId: t.subagent_type,
        }),
      ),
    );

    const blocks = results.map((r, i) => {
      const head = `### Subagente ${i + 1} (${tasks[i].subagent_type})`;
      return r.isError ? `${head} — FALLÓ\n${r.text}` : `${head}\n${r.text}`;
    });

    // isError sólo si TODOS fallan: si alguno trae resultado útil, el turno sigue.
    return {
      output: blocks.join("\n\n"),
      isError: results.every((r) => r.isError),
    };
  },
};
