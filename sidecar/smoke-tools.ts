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
import type { ToolContext } from "./tools/types";

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

  rmSync(root, { recursive: true, force: true });
  console.log(failures === 0 ? "\nTODO OK ✓" : `\n${failures} FALLO(S) ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
