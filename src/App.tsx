import { useEffect, useState } from "react";

import { useSession } from "./state/session";
import { connectSidecar } from "./transport/client";
import { ChatPanel } from "./components/ChatPanel";
import { Composer } from "./components/Composer";
import { SettingsModal } from "./components/SettingsModal";
import { LogsPanel } from "./components/LogsPanel";
import "./App.css";

function App() {
  const connected = useSession((s) => s.connected);
  const model = useSession((s) => s.model);
  const logErrors = useSession((s) => s.logs.reduce((n, l) => n + (l.level === "error" ? 1 : 0), 0));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  useEffect(() => {
    connectSidecar();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">MyAgent</div>
        <button
          className={`icon-btn logs-toggle ${logsOpen ? "active" : ""}`}
          onClick={() => setLogsOpen((v) => !v)}
          title="Logs de desarrollo"
          aria-label="Mostrar u ocultar logs de desarrollo"
        >
          Logs
          {logErrors > 0 && <span className="logs-badge">{logErrors}</span>}
        </button>
        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          title="Configuración"
          aria-label="Abrir configuración"
        >
          ⚙
        </button>
        <div className={`conn ${connected ? "on" : "off"}`}>
          <span className="conn-dot" />
          {connected ? model ?? "conectado" : "sin conexión"}
        </div>
      </header>
      <main className="main">
        <ChatPanel />
      </main>
      {logsOpen && <LogsPanel onClose={() => setLogsOpen(false)} />}
      <footer className="bottombar">
        <Composer onOpenSettings={() => setSettingsOpen(true)} />
      </footer>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;
