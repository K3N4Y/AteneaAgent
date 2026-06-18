// Árbol de archivos lateral. Carga perezosa: cada carpeta pide sus hijos al
// sidecar (requestDir) la primera vez que se expande, así no recorremos todo el
// proyecto de golpe. Clic en un archivo inserta su ruta en el composer.

import { useEffect, useState } from "react";
import { requestDir } from "../transport/client";
import { useSession } from "../state/session";
import type { DirEntry } from "../transport/protocol";

function join(dir: string, name: string): string {
  return dir === "." ? name : `${dir}/${name}`;
}

// Glifo + color por extensión, estilo VS Code. ponytail: mapa plano en vez de
// una librería de iconos; agregar react-file-icon si querés parity exacto.
function fileIcon(name: string): [glyph: string, color: string] {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, [string, string]> = {
    ts: ["TS", "#3178c6"], tsx: ["TS", "#3178c6"],
    js: ["JS", "#f0db4f"], jsx: ["JS", "#f0db4f"], mjs: ["JS", "#f0db4f"], cjs: ["JS", "#f0db4f"],
    json: ["{}", "#f1502f"],
    html: ["<>", "#e44d26"], htm: ["<>", "#e44d26"],
    css: ["#", "#42a5f5"], scss: ["#", "#cf649a"],
    md: ["i", "#42a5f5"], markdown: ["i", "#42a5f5"],
    yml: ["!", "#cb4b16"], yaml: ["!", "#cb4b16"], toml: ["⚙", "#9e9e9e"],
    rs: ["RS", "#dea584"],
    svg: ["▢", "#ffb13b"], png: ["▢", "#a074c4"], jpg: ["▢", "#a074c4"], jpeg: ["▢", "#a074c4"],
    gitignore: ["◆", "#e8654f"],
  };
  return map[ext] ?? ["▢", "#7d8590"];
}

function TreeNode({ entry, path }: { entry: DirEntry; path: string }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const insert = useSession((s) => s.insertIntoComposer);

  const onClick = async () => {
    if (!entry.isDir) {
      insert(path);
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && children === null) setChildren(await requestDir(path));
  };

  const [glyph, color] = entry.isDir ? ["", ""] : fileIcon(entry.name);

  return (
    <div className="tree-node">
      <button className={`tree-row ${entry.isDir ? "is-dir" : "is-file"}`} onClick={onClick} title={path}>
        <span className="tree-twist">{entry.isDir ? (open ? "▾" : "▸") : ""}</span>
        <span className="tree-icon" style={{ color }}>{glyph}</span>
        <span className="tree-label">{entry.name}</span>
      </button>
      {open && children && (
        <div className="tree-children">
          {children.length === 0 && <div className="tree-empty">vacío</div>}
          {children.map((c) => (
            <TreeNode key={c.name} entry={c} path={join(path, c.name)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const projectPath = useSession((s) => s.projectPath);
  const [roots, setRoots] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setRoots(null);
      return;
    }
    let alive = true;
    setRoots(null);
    requestDir(".").then((e) => alive && setRoots(e));
    return () => {
      alive = false;
    };
  }, [projectPath]);

  if (!projectPath) return <div className="tree-empty">Elegí un proyecto.</div>;
  if (roots === null) return <div className="tree-empty">Cargando…</div>;
  if (roots.length === 0) return <div className="tree-empty">Sin archivos.</div>;

  return (
    <div className="file-tree">
      {roots.map((e) => (
        <TreeNode key={e.name} entry={e} path={e.name} />
      ))}
    </div>
  );
}
