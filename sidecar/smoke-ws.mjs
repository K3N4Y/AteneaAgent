// Smoke test del transporte: conecta al sidecar, espera "ready", manda un
// user_message y muestra los eventos. Sin API key debe llegar un "error" claro.
import WebSocket from "ws";

const port = process.env.MYAGENT_SIDECAR_PORT || 8137;
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const seen = [];

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "user_message", text: "hola", agentId: "build" }));
});
ws.on("message", (raw) => {
  const ev = JSON.parse(raw.toString());
  seen.push(ev.type);
  console.log("←", JSON.stringify(ev).slice(0, 160));
});

setTimeout(() => {
  const ok = seen.includes("ready") && seen.includes("error");
  console.log(ok ? "\nTRANSPORTE OK ✓ (ready + error sin key)" : "\nFALLO ✗ eventos: " + seen.join(","));
  ws.close();
  process.exit(ok ? 0 : 1);
}, 2500);
