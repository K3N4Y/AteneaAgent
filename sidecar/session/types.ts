import type { LlmMessage } from "../providers/types";
import type { AgentId } from "../engine/events";
import { SnapshotStore } from "../edit/hashline/snapshot-store";

/** Una sesión = historial + proyecto activo + agente + snapshots. */
export interface Session {
  id: string;
  agentId: AgentId;
  projectRoot: string;
  messages: LlmMessage[];
  snapshots: SnapshotStore;
}
