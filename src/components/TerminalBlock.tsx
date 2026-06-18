// Render tipo terminal de la salida de run_command. El output ya viene como
// `$ <cmd>\n[exit N]\n<stdout+stderr combinados>` (o variantes de timeout /
// "No se pudo ejecutar: …"). Coloreamos la línea del prompt y la del estado;
// el resto es salida cruda. ponytail: no es streaming en vivo (el backend
// captura todo y devuelve al final); la línea viva llegaría con un evento de
// chunks desde el sidecar — agregarlo cuando se necesite ver builds largos.

function classify(line: string): "cmd" | "status" | "out" {
  if (line.startsWith("$ ")) return "cmd";
  if (/^\[(exit|timeout)/.test(line)) return "status";
  return "out";
}

export function TerminalBlock({ output }: { output: string }) {
  const lines = output.split("\n");
  return (
    <div className="terminal-block">
      {lines.map((line, i) => (
        <div key={i} className={`term-line term-${classify(line)}`}>
          {line || " "}
        </div>
      ))}
    </div>
  );
}
