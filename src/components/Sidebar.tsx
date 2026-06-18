// Rail lateral con dos pestañas: el árbol de archivos y la lista de sesiones.

import { useState } from "react";
import { FileTree } from "./FileTree";
import { HistoryList } from "./HistoryList";

export function Sidebar() {
  const [tab, setTab] = useState<"files" | "history">("files");
  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>
          Archivos
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          Sesiones
        </button>
      </div>
      <div className="sidebar-body">{tab === "files" ? <FileTree /> : <HistoryList />}</div>
    </aside>
  );
}
