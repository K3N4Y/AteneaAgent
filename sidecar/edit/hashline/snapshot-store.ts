// Snapshots por sesión: guarda versiones completas observadas por read/search/
// write para validar tags y saber qué líneas fueron visibles para el modelo.

import {
  MAX_SNAPSHOT_PATHS,
  MAX_SNAPSHOT_VERSIONS_PER_PATH,
} from "../../config/limits";
import { computeFileHash } from "./hash";

export interface Snapshot {
  path: string;
  hash: string;
  text: string;
  seenLines?: Set<number>;
}

function mergeSeenLines(
  snapshot: Snapshot,
  seenLines: Iterable<number> | undefined,
): void {
  if (seenLines === undefined) return;
  snapshot.seenLines ??= new Set<number>();
  for (const line of seenLines) snapshot.seenLines.add(line);
}

export class SnapshotStore {
  private byPath = new Map<string, Snapshot[]>();

  /** Graba una versión completa observada y devuelve su tag hashline. */
  record(path: string, text: string, seenLines?: Iterable<number>): string {
    const hash = computeFileHash(text);
    let versions = this.byPath.get(path);
    if (!versions) {
      versions = [];
      this.byPath.set(path, versions);
    }

    const existing = versions.find((snapshot) => snapshot.hash === hash);
    if (existing) {
      existing.text = text;
      mergeSeenLines(existing, seenLines);
      versions = [
        existing,
        ...versions.filter((snapshot) => snapshot !== existing),
      ];
      this.byPath.set(path, versions);
      this.evictOldPaths(path);
      return hash;
    }

    versions.unshift({ path, hash, text });
    mergeSeenLines(versions[0], seenLines);
    if (versions.length > MAX_SNAPSHOT_VERSIONS_PER_PATH)
      versions.length = MAX_SNAPSHOT_VERSIONS_PER_PATH;
    this.evictOldPaths(path);
    return hash;
  }

  /** Última versión observada de `path`. */
  head(path: string): Snapshot | undefined {
    return this.byPath.get(path)?.[0];
  }

  /** Busca un snapshot por path + hash. */
  byHash(path: string, hash: string): Snapshot | undefined {
    return this.byPath.get(path)?.find((snapshot) => snapshot.hash === hash);
  }

  /** Alias de compatibilidad con el store anterior. */
  find(path: string, hash: string): Snapshot | undefined {
    return this.byHash(path, hash);
  }

  private evictOldPaths(justUsed: string): void {
    if (this.byPath.size <= MAX_SNAPSHOT_PATHS) return;
    for (const key of this.byPath.keys()) {
      if (key !== justUsed) {
        this.byPath.delete(key);
        break;
      }
    }
  }
}
