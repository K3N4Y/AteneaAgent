// Render coloreado del diff que edit_file / write_file ya devuelven en su
// `output`. Formato (ver sidecar/edit/hashline/apply.ts → diffPreview):
//   [PATH#HASH]        cabecera de sección
//   -N:texto           línea quitada
//   +N:texto           línea agregada
// Cualquier otra línea es contexto (p. ej. "Archivo creado (N líneas)." de
// write_file, o "(sin cambios)"). No re-parseamos: clasificamos por el primer
// carácter, que es justo lo que el backend ya codifica.

function classify(line: string): "header" | "del" | "add" | "ctx" {
  if (/^\[.+#.+\]$/.test(line)) return "header";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("+")) return "add";
  return "ctx";
}

export function DiffView({ output }: { output: string }) {
  const lines = output.split("\n");
  return (
    <div className="diff-view">
      {lines.map((line, i) => (
        <div key={i} className={`diff-line diff-${classify(line)}`}>
          {line || " "}
        </div>
      ))}
    </div>
  );
}
