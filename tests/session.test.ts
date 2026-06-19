import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const { useSession } = await import("../src/state/session");

test("user turns create stable ids for chat messages", () => {
  useSession.getState().newSession();
  useSession.getState().startUserTurn("hello");

  assert.deepEqual(
    useSession.getState().messages.map((message) => message.id),
    ["user:0", "assistant:0"],
  );
});

test("task tool calls initialize subagents with stable ids", () => {
  useSession.getState().newSession();
  useSession.getState().startUserTurn("inspect this");
  useSession.getState().addToolCall("task-1", "task", {
    tasks: [
      { subagent_type: "explore", prompt: "one" },
      { subagent_type: "explore", prompt: "two" },
    ],
  });

  const messages = useSession.getState().messages;
  const assistant = messages[messages.length - 1];
  assert.equal(assistant.role, "assistant");

  const [taskCall] = assistant.toolCalls;
  assert.deepEqual(
    taskCall.subagents?.map((run) => run.id),
    ["task-1:0", "task-1:1"],
  );
});
