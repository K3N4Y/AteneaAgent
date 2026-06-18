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

  return (
    <div className="tree-node">
      <button className={`tree-row ${entry.isDir ? "is-dir" : "is-file"}`} onClick={onClick} title={path}>
        <span className="tree-twist">{entry.isDir ? (open ? "▾" : "▸") : ""}</span>
        <span className="tree-icon">{entry.isDir ? "📁" : "📄"}</span>
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
