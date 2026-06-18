// Smoke test determinista del motor hashline (sin LLM). Ejercita
// write_file → read_file → edit_file en un dir temporal y verifica los casos
// clave: round-trip, mismatch de hash, rangos, y todas las ops.
//
// Correr:  pnpm --dir sidecar exec tsx smoke-tools.ts

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SnapshotStore } from "./edit/hashline/snapshot-store";
import { readFileTool } from "./tools/read";
import { writeFileTool } from "./tools/write";
import { editFileTool } from "./tools/edit";
import { listDirTool } from "./tools/list-dir";
import { searchTool } from "./tools/search";
import { runCommandTool } from "./tools/run-command";
import { startAppTool } from "./tools/start-app";
import { submitPlanTool } from "./tools/submit-plan";
import type { ToolContext } from "./tools/types";
import type { ChildProcess } from "node:child_process";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function headerHash(output: string): string {
  const m = output.match(/^\[[^\]]*#([^\]]+)\]/);
  if (!m) throw new Error(`sin cabecera en: ${output.slice(0, 60)}`);
  return m[1];
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "myagent-smoke-"));
  const ctx: ToolContext = { projectRoot: root, snapshots: new SnapshotStore() };
  console.log(`temp: ${root}`);

  // 1. write_file crea el archivo.
  const w = await writeFileTool.run(
    { path: "a.ts", content: "const X = 1;\nconst Y = 2;\nconst Z = 3;" },
    ctx,
  );
  check("write_file ok", !w.isError, w.output);

  // 2. write_file sin overwrite sobre existente → error.
  const w2 = await writeFileTool.run({ path: "a.ts", content: "x" }, ctx);
  check("write_file no sobrescribe sin overwrite", w2.isError);

  // 3. read_file numera y trae hash.
  const r = await readFileTool.run({ path: "a.ts" }, ctx);
  check("read_file ok", !r.isError);
  check("read_file numera líneas", r.output.includes("\n1:const X = 1;"), r.output);
  const tag = headerHash(r.output);

  // 4. edit_file SWAP usando la cabecera devuelta.
  const e = await editFileTool.run(
    { input: `[a.ts#${tag}]\nSWAP 2.=2:\n+const Y = 22;` },
    ctx,
  );
  check("edit_file SWAP ok", !e.isError, e.output);
  check(
    "archivo refleja el SWAP",
    readFileSync(join(root, "a.ts"), "utf8") === "const X = 1;\nconst Y = 22;\nconst Z = 3;",
    readFileSync(join(root, "a.ts"), "utf8"),
  );

  // 5. edit con tag viejo → mismatch (el archivo cambió).
  const e2 = await editFileTool.run(
    { input: `[a.ts#${tag}]\nSWAP 1.=1:\n+const X = 999;` },
    ctx,
  );
  check("edit_file detecta mismatch de hash", e2.isError && e2.output.includes("cambió"));

  // 6. INS.HEAD + INS.TAIL + DEL combinados (re-leer para tag fresco).
  const r2 = await readFileTool.run({ path: "a.ts" }, ctx);
  const tag2 = headerHash(r2.output);
  const e3 = await editFileTool.run(
    {
      input:
        `[a.ts#${tag2}]\n` +
        `INS.HEAD:\n+// header\n` +
        `DEL 3\n` + // borra "const Z = 3;" (línea 3 original)
        `INS.TAIL:\n+// footer`,
    },
    ctx,
  );
  check("edit_file INS.HEAD/DEL/INS.TAIL ok", !e3.isError, e3.output);
  const after = readFileSync(join(root, "a.ts"), "utf8");
  check(
    "resultado combinado correcto",
    after === "// header\nconst X = 1;\nconst Y = 22;\n// footer",
    JSON.stringify(after),
  );

  // 7. read_file con rango.
  const r3 = await readFileTool.run({ path: "a.ts", range: "2-3" }, ctx);
  check(
    "read_file rango 2-3",
    r3.output.includes("\n2:const X = 1;") && r3.output.includes("\n3:const Y = 22;") && !r3.output.includes("\n1:"),
    r3.output,
  );

  // 8. ruta fuera del proyecto → error.
  const r4 = await readFileTool.run({ path: "../../etc/passwd" }, ctx);
  check("read_file rechaza ruta fuera del proyecto", r4.isError, r4.output);

  // ── Fase 1: list_dir / search / run_command / submit_plan ──────────────────

  // 9. list_dir lista entradas y marca los directorios con "/".
  await writeFileTool.run({ path: "sub/b.ts", content: "export const ok = true;\n" }, ctx);
  const ld = await listDirTool.run({}, ctx);
  check("list_dir lista a.ts", !ld.isError && ld.output.includes("a.ts"), ld.output);
  check("list_dir marca el dir con /", ld.output.includes("sub/"), ld.output);

  // 10. search encuentra contenido y lo ubica como path:línea:texto.
  const sr = await searchTool.run({ query: "const Y" }, ctx);
  check("search encuentra coincidencia en a.ts", !sr.isError && sr.output.includes("a.ts:"), sr.output);
  const sr0 = await searchTool.run({ query: "no-existe-zzz" }, ctx);
  check("search sin coincidencias", !sr0.isError && sr0.output.includes("Sin coincidencias"), sr0.output);
  const srx = await searchTool.run({ query: "const\\s+ok", regex: true, path: "sub" }, ctx);
  check("search regex acotado a subdir", !srx.isError && srx.output.includes("sub/b.ts:"), srx.output);

  // 11. run_command: confirma true ⇒ ejecuta; false ⇒ no; sin confirm ⇒ denegado.
  const allow: ToolContext = { ...ctx, confirm: async () => true };
  const rc = await runCommandTool.run({ command: "echo hola-mundo" }, allow);
  check("run_command corre con confirmación", !rc.isError && rc.output.includes("hola-mundo"), rc.output);
  const deny: ToolContext = { ...ctx, confirm: async () => false };
  const rcd = await runCommandTool.run({ command: "echo no-deberia" }, deny);
  check("run_command rechazado no ejecuta", rcd.isError && rcd.output.includes("rechazó"), rcd.output);
  const rcn = await runCommandTool.run({ command: "echo nada" }, ctx);
  check("run_command sin confirm asume denegado", rcn.isError, rcn.output);

  // 12. submit_plan emite el plan vía onPlan.
  let captured = "";
  const planCtx: ToolContext = { ...ctx, onPlan: (md) => { captured = md; } };
  const sp = await submitPlanTool.run({ markdown: "# Plan\n1. paso" }, planCtx);
  check("submit_plan ok", !sp.isError, sp.output);
  check("submit_plan emite el markdown por onPlan", captured.includes("# Plan"), captured);

  // ── Fase 3: start_app (proceso de fondo de larga duración) ─────────────────

  const apps: ChildProcess[] = [];
  const appCtx: ToolContext = { ...ctx, confirm: async () => true, trackProcess: (c) => apps.push(c) };

  // 13. start_app deja vivo un proceso de larga duración y lo rastrea para limpieza.
  const sa = await startAppTool.run({ command: "sleep 5", wait_ms: 300 }, appCtx);
  check("start_app reporta app corriendo", !sa.isError && sa.output.includes("sigue viva"), sa.output);
  check("start_app rastrea el proceso", apps.length === 1 && apps[0].killed === false, String(apps.length));
  apps[0].kill("SIGKILL");

  // 14. proceso que termina solo → no quedó corriendo (isError).
  const sa2 = await startAppTool.run({ command: "true", wait_ms: 1000 }, appCtx);
  check("start_app detecta proceso que termina", sa2.isError && sa2.output.includes("no quedó corriendo"), sa2.output);

  // 15. la cadena `ready` corta la espera antes del wait_ms.
  const sa3 = await startAppTool.run({ command: "echo READY; sleep 5", ready: "READY", wait_ms: 5000 }, appCtx);
  check("start_app corta al ver la cadena ready", !sa3.isError && sa3.output.includes("apareció"), sa3.output);
  apps[apps.length - 1].kill("SIGKILL");

  // 16. sin confirm ⇒ denegado (mismo gate que run_command).
  const sa4 = await startAppTool.run({ command: "sleep 5" }, ctx);
  check("start_app sin confirm asume denegado", sa4.isError, sa4.output);

  rmSync(root, { recursive: true, force: true });
  console.log(failures === 0 ? "\nTODO OK ✓" : `\n${failures} FALLO(S) ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
