// Persistencia de sesiones en localStorage. Una sesión = el transcript de la UI
// + su agente/proyecto + un título derivado del primer mensaje del usuario.
//
// ponytail: localStorage (tope ~5 MB) alcanza para el MVP; si las sesiones se
// vuelven grandes o hay que compartirlas entre máquinas, mover la persistencia
// al sidecar (disco). Cap de MAX_SESSIONS para no llenar la cuota.

import type { AgentId } from "../transport/protocol";
import type { Message } from "./session";

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  agentId: AgentId;
  projectPath?: string;
  messages: Message[];
}

const KEY = "myagent:sessions";
const MAX_SESSIONS = 30;

export function listSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as StoredSession[]) : [];
    return arr.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeAll(sessions: StoredSession[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Cuota llena o storage no disponible: la sesión sigue viva en memoria.
  }
}

export function titleFor(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = first?.text.trim() || "Sesión sin título";
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

/** Inserta o actualiza la sesión (upsert por id). No persiste sesiones vacías. */
export function saveSession(s: StoredSession): void {
  if (s.messages.length === 0) return;
  const rest = listSessions().filter((x) => x.id !== s.id);
  writeAll([s, ...rest]);
}

export function deleteSession(id: string): void {
  writeAll(listSessions().filter((s) => s.id !== id));
}
