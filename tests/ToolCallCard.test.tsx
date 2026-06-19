import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolCallCard } from "../src/components/ToolCallCard";

test("list_dir falls back to . when input has no path", () => {
  const html = renderToStaticMarkup(
    createElement(ToolCallCard, {
      call: {
        id: "call-1",
        name: "list_dir",
        input: {},
        done: true,
      },
    }),
  );

  assert.match(html, /<span class="tool-arg">\.<\/span>/);
});

test("subagent status uses a native img element", () => {
  const html = renderToStaticMarkup(
    createElement(ToolCallCard, {
      call: {
        id: "task-1",
        name: "task",
        input: {},
        done: false,
        subagents: [{ id: "task-1:0", type: "explore", toolCalls: [] }],
      },
    }),
  );

  assert.match(html, /<img[^>]+class="sprout"[^>]+alt="subagente en curso"/);
  assert.doesNotMatch(html, /role="img"/);
});
