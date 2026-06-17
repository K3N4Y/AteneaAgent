// submit_plan: el agente Plan lo llama para PRESENTAR su plan final al usuario.
// No toca el sistema de archivos: sólo emite un evento `plan` (vía ctx.onPlan)
// que la UI renderiza como una tarjeta aprobable. Es la única "acción" del
// agente Plan; todo lo demás que tiene es de lectura.

import { z } from "zod";

import { type Tool, type ToolResult } from "./types";

const schema = z.object({
  markdown: z
    .string()
    .min(1)
    .describe("El plan completo en markdown: pasos ordenados, archivos a tocar y riesgos."),
});

export const submitPlanTool: Tool<z.infer<typeof schema>> = {
  name: "submit_plan",
  description:
    "Presenta tu plan final al usuario para que lo apruebe. Pasá el plan completo " +
    "en markdown (pasos ordenados, archivos a tocar, riesgos). Llamalo UNA sola " +
    "vez cuando el plan esté listo y luego terminá: no sigas explorando.",
  schema,
  async run({ markdown }, ctx): Promise<ToolResult> {
    if (!ctx.onPlan) {
      return {
        output: "No hay canal para presentar el plan en este contexto.",
        isError: true,
      };
    }
    ctx.onPlan(markdown);
    return {
      output: "Plan presentado al usuario para aprobación. Terminá tu turno aquí.",
      isError: false,
    };
  },
};
