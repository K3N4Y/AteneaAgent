// Historial de mensajes por sesión. La API del modelo es stateless: en cada
// llamada se manda el historial completo, que vive aquí.

import type { AgentId } from "../engine/events";
import { SnapshotStore } from "../edit/hashline/snapshot-store";
import type { Session } from "./types";

export class SessionStore {
  private sessions = new Map<string, Session>();

  getOrCreate(id: string, projectRoot: string, agentId: AgentId): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, agentId, projectRoot, messages: [], snapshots: new SnapshotStore() };
      this.sessions.set(id, s);
    }
    return s;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
