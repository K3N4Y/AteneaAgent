// Catálogo de herramientas y el SET por agente (= permisos). Restringir las
// tools por agente es la forma robusta de garantizar que, p. ej., Plan no
// escriba: si la tool no está en su lista, el modelo no puede invocarla.

import type { AgentId } from "../engine/events";
import type { Tool } from "./types";
import { readFileTool } from "./read";
import { writeFileTool } from "./write";
import { editFileTool } from "./edit";

export const ALL_TOOLS: Tool[] = [readFileTool, writeFileTool, editFileTool];

/**
 * Tools habilitadas por agente. En Fase 0 alcanza con read/write/edit; Fase 1
 * agrega list_dir/search/run_command y afina la separación.
 */
const TOOLS_BY_AGENT: Record<AgentId, Tool[]> = {
  plan: [readFileTool], // sólo lectura
  build: [readFileTool, writeFileTool, editFileTool],
  e2e: [readFileTool, writeFileTool, editFileTool],
};

export function toolsForAgent(agentId: AgentId): Tool[] {
  return TOOLS_BY_AGENT[agentId] ?? TOOLS_BY_AGENT.build;
}
