// Definición NEUTRAL de una herramienta (agnóstica del proveedor): nombre,
// descripción, esquema Zod y `run`. Cada adaptador la convierte al formato de
// function-calling de su proveedor (el Zod se transforma a JSON Schema aquí).

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ChildProcess } from "node:child_process";

import type { ToolSpec } from "../providers/types";
import type { SnapshotStore } from "../edit/hashline/snapshot-store";

/** Petición de confirmación humana para una acción difícil de revertir. */
export interface PermissionRequest {
  /** Comando de shell que se quiere ejecutar. */
  command: string;
  /** Directorio de trabajo (relativo al proyecto) donde correría. */
  cwd?: string;
}

/** Contexto que recibe cada `run`: proyecto activo + snapshots de la sesión. */
export interface ToolContext {
  /** Raíz del proyecto activo. Todas las rutas se resuelven dentro de aquí. */
  projectRoot: string;
  /** Store de snapshots de la sesión (lo usan read_file/edit_file). */
  snapshots: SnapshotStore;
  /**
   * Pide confirmación humana antes de una acción irreversible (run_command).
   * Resuelve `true` si el usuario aprueba. El server la cablea contra la UI;
   * si no está provista (p. ej. en tests), la acción debe asumirse DENEGADA.
   */
  confirm?: (req: PermissionRequest) => Promise<boolean>;
  /**
   * Presenta un plan en markdown al usuario (lo usa submit_plan del agente
   * Plan). El server lo cablea a un evento `plan` hacia la UI.
   */
  onPlan?: (markdown: string) => void;
  /**
   * Registra un proceso de FONDO de larga duración (start_app) para matarlo al
   * cerrar la sesión y no dejar servidores huérfanos. El server lo cablea; si no
   * está provista (tests), start_app igual arranca pero nadie lo limpia.
   */
  trackProcess?: (child: ChildProcess) => void;
}

export interface ToolResult {
  output: string;
  isError: boolean;
}

export interface Tool<I = any> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}

/** Error de herramienta: se reporta como resultado (is_error), no como excepción. */
export class ToolError extends Error {}

/** Convierte una Tool (Zod) en su ToolSpec (JSON Schema) para el proveedor. */
export function toToolSpec(tool: Tool): ToolSpec {
  // Cast a `any`: con el genérico ZodType<I> la inferencia de zod-to-json-schema
  // recursa hasta TS2589. El resultado lo normalizamos a Record igual.
  const json = zodToJsonSchema(tool.schema as any, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  // OpenAI ignora $schema; lo quitamos para no ensuciar el parámetro.
  delete json.$schema;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: json,
  };
}
