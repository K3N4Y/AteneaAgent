// Store de Zustand: estado compartido de la sesión + las acciones que el
// cliente de transporte invoca al recibir cada evento del motor. El streaming
// muta el store y React re-renderiza solo (los componentes leen con selectores).

import { create } from "zustand";
import type { AgentId } from "../transport/protocol";

export interface UiToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  done: boolean;
}

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: UiToolCall[] };

interface SessionState {
  agentId: AgentId;
  messages: Message[];
  streaming: boolean;
  connected: boolean;
  providerId?: string;
  model?: string;

  setAgent(id: AgentId): void;
  setConnected(connected: boolean): void;
  onReady(providerId: string, model: string): void;

  // Acciones llamadas por transport/client.ts con cada evento del motor.
  startUserTurn(text: string): void; // agrega msg user + msg assistant vacío
  appendAssistantDelta(text: string): void;
  addToolCall(id: string, name: string, input: unknown): void;
  resolveToolCall(id: string, output: string, isError: boolean): void;
  finishTurn(): void;
  pushErrorNote(message: string): void;
}

// Helpers para actualizar el ÚLTIMO mensaje del asistente de forma inmutable.
function updateLastAssistant(
  messages: Message[],
  fn: (m: Extract<Message, { role: "assistant" }>) => Extract<Message, { role: "assistant" }>,
): Message[] {
  const idx = lastAssistantIndex(messages);
  if (idx === -1) return messages;
  const copy = messages.slice();
  copy[idx] = fn(copy[idx] as Extract<Message, { role: "assistant" }>);
  return copy;
}

function lastAssistantIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return i;
  }
  return -1;
}

export const useSession = create<SessionState>((set) => ({
  agentId: "build",
  messages: [],
  streaming: false,
  connected: false,

  setAgent: (agentId) => set({ agentId }),
  setConnected: (connected) => set({ connected }),
  onReady: (providerId, model) => set({ providerId, model, connected: true }),

  startUserTurn: (text) =>
    set((s) => ({
      streaming: true,
      messages: [
        ...s.messages,
        { role: "user", text },
        { role: "assistant", text: "", toolCalls: [] },
      ],
    })),

  appendAssistantDelta: (text) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({ ...m, text: m.text + text })),
    })),

  addToolCall: (id, name, input) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        toolCalls: [...m.toolCalls, { id, name, input, done: false }],
      })),
    })),

  resolveToolCall: (id, output, isError) =>
    set((s) => ({
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.id === id ? { ...t, output, isError, done: true } : t,
        ),
      })),
    })),

  finishTurn: () => set({ streaming: false }),

  pushErrorNote: (message) =>
    set((s) => ({
      streaming: false,
      messages: updateLastAssistant(s.messages, (m) => ({
        ...m,
        text: m.text ? `${m.text}\n\n⚠️ ${message}` : `⚠️ ${message}`,
      })),
    })),
}));
