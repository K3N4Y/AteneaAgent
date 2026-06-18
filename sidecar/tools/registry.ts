// Catálogo de herramientas y el SET por agente (= permisos). Restringir las
// tools por agente es la forma robusta de garantizar que, p. ej., Plan no
// escriba: si la tool no está en su lista, el modelo no puede invocarla.

import type { AgentId } from "../engine/events";
import type { Tool } from "./types";
import { readFileTool } from "./read";
import { writeFileTool } from "./write";
import { editFileTool } from "./edit";
import { listDirTool } from "./list-dir";
import { searchTool } from "./search";
import { runCommandTool } from "./run-command";
import { startAppTool } from "./start-app";
import { submitPlanTool } from "./submit-plan";

export const ALL_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  searchTool,
  runCommandTool,
  startAppTool,
  submitPlanTool,
];

/**
 * Tools habilitadas por agente (Fase 1):
 * - plan: sólo lectura/exploración + submit_plan para presentar el plan. NUNCA
 *   escribe ni corre comandos.
 * - build: lectura + escritura/edición + exploración + run_command + start_app
 *   (con confirmación humana).
 * - e2e: igual que build. El flujo E2E es Plan→Build con gate humano: el primer
 *   turno usa el set de `plan` (sólo lectura) y, al aprobar, la construcción usa
 *   este set — el ruteo por fase vive en server.ts (msg.approve).
 */
const READ_ONLY = [readFileTool, listDirTool, searchTool];
const WRITE = [writeFileTool, editFileTool, runCommandTool, startAppTool];

const TOOLS_BY_AGENT = {
  plan: [...READ_ONLY, submitPlanTool],
  build: [...READ_ONLY, ...WRITE],
  e2e: [...READ_ONLY, ...WRITE],
} satisfies Record<AgentId, Tool[]>;

export function toolsForAgent(agentId: AgentId): Tool[] {
  return TOOLS_BY_AGENT[agentId] ?? TOOLS_BY_AGENT.build;
}
