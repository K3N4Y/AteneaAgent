// Snapshots por sesión: guarda lo que `read_file` leyó (líneas exactas + hash)
// para poder verificar/recuperar en `edit_file`. En memoria, por sesión.

export interface Snapshot {
  hash: string;
  lines: string[];
}

const MAX_VERSIONS_PER_PATH = 4; // como oh-my-pi
const MAX_PATHS = 30;

export class SnapshotStore {
  private byPath = new Map<string, Snapshot[]>();

  /** Graba una versión leída/escrita de un archivo. */
  record(path: string, lines: string[], hash: string): void {
    let versions = this.byPath.get(path);
    if (!versions) {
      versions = [];
      this.byPath.set(path, versions);
    }
    // Evita duplicar si ya tenemos ese hash en cabeza.
    if (versions.length > 0 && versions[versions.length - 1].hash === hash) {
      versions[versions.length - 1] = { hash, lines };
    } else {
      versions.push({ hash, lines });
      if (versions.length > MAX_VERSIONS_PER_PATH) versions.shift();
    }
    this.evictOldPaths(path);
  }

  /** Busca un snapshot por path + hash. */
  find(path: string, hash: string): Snapshot | undefined {
    const versions = this.byPath.get(path);
    if (!versions) return undefined;
    return versions.find((v) => v.hash === hash);
  }

  private evictOldPaths(justUsed: string): void {
    if (this.byPath.size <= MAX_PATHS) return;
    // Map mantiene orden de inserción: borra el más viejo que no sea el actual.
    for (const key of this.byPath.keys()) {
      if (key !== justUsed) {
        this.byPath.delete(key);
        break;
      }
    }
  }
}
