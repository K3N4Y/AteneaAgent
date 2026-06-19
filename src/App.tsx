import { useEffect, useState } from "react";

import { useSession } from "./state/session";
import { connectSidecar } from "./transport/client";
import { ChatPanel } from "./components/ChatPanel";
import { Composer } from "./components/Composer";
import { SettingsModal } from "./components/SettingsModal";
import { LogsPanel } from "./components/LogsPanel";
import { Sidebar } from "./components/Sidebar";
import { ProjectPicker } from "./components/ProjectPicker";
import { ProjectButton } from "./components/ProjectButton";
import { ProjectModal } from "./components/ProjectModal";
import "./App.css";

function App() {
  const connected = useSession((s) => s.connected);
  const model = useSession((s) => s.model);
  const empty = useSession((s) => s.messages.length === 0);
  const logErrors = useSession((s) =>
    s.logs.reduce((n, l) => n + (l.level === "error" ? 1 : 0), 0),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(false);

  useEffect(() => {
    connectSidecar();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">MyAgent</div>
        <ProjectPicker onClick={() => setProjectsOpen(true)} />
        <button
          type="button"
          className={`icon-btn sidebar-toggle ${sidebarOpen ? "active" : ""}`}
          onClick={() => setSidebarOpen((v) => !v)}
          title="Mostrar u ocultar el panel lateral"
          aria-label="Mostrar u ocultar el panel lateral"
        >
          ☰
        </button>
        <button
          type="button"
          className={`icon-btn logs-toggle ${logsOpen ? "active" : ""}`}
          onClick={() => setLogsOpen((v) => !v)}
          title="Logs de desarrollo"
          aria-label="Mostrar u ocultar logs de desarrollo"
        >
          Logs
          {logErrors > 0 && <span className="logs-badge">{logErrors}</span>}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          title="Configuración"
          aria-label="Abrir configuración"
        >
          ⚙
        </button>
        <div className={`conn ${connected ? "on" : "off"}`}>
          <span className="conn-dot" />
          {connected ? (model ?? "conectado") : "sin conexión"}
        </div>
      </header>
      <div className="body">
        {sidebarOpen && <Sidebar />}
        <div className={`content ${empty ? "is-welcome" : ""}`}>
          <main className="main">
            <div className="chat-scroll">
              <ChatPanel />
            </div>
          </main>
          {logsOpen && <LogsPanel onClose={() => setLogsOpen(false)} />}
          <footer className="bottombar">
            <div className="composer-area">
              <ProjectButton onClick={() => setProjectsOpen(true)} />
              <Composer onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </footer>
        </div>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {projectsOpen && <ProjectModal onClose={() => setProjectsOpen(false)} />}
    </div>
  );
}

export default App;
