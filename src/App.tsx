import { useEffect } from "react";

import { useSession } from "./state/session";
import { connectSidecar } from "./transport/client";
import { ChatPanel } from "./components/ChatPanel";
import { Composer } from "./components/Composer";
import { AgentSwitcher } from "./components/AgentSwitcher";
import "./App.css";

function App() {
  const connected = useSession((s) => s.connected);
  const model = useSession((s) => s.model);

  useEffect(() => {
    connectSidecar();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">MyAgent</div>
        <AgentSwitcher />
        <div className={`conn ${connected ? "on" : "off"}`}>
          <span className="conn-dot" />
          {connected ? model ?? "conectado" : "sin conexión"}
        </div>
      </header>
      <main className="main">
        <ChatPanel />
      </main>
      <footer className="bottombar">
        <Composer />
      </footer>
    </div>
  );
}

export default App;
