import assert from "node:assert/strict";
import { test } from "node:test";
import { transcriptFromLog } from "../shared/transcript.js";

test("turns OpenCode json events into chat and tool calls", () => {
  const stdout = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({
      type: "tool_use",
      part: {
        tool: "shell",
        state: { status: "completed", input: { command: "ls /workspaces" }, output: "test\n" },
      },
    }),
    JSON.stringify({
      type: "tool_use",
      part: {
        tool: "write",
        state: { status: "error", input: { path: "/app/note.md", content: "x".repeat(3000) }, error: "Unable to write /app/note.md" },
      },
    }),
    JSON.stringify({ type: "text", part: { text: "Saved the note." } }),
    JSON.stringify({ type: "step_finish", part: { reason: "stop", cost: 0.01234 } }),
    "not json",
  ].join("\n");
  const log = `# stdout\n${stdout}\n# stderr\nERROR\n  Unrecognized flag: --dir\n`;
  const items = transcriptFromLog(log);

  assert.equal(items[0]?.kind, "tool");
  if (items[0]?.kind === "tool") {
    assert.equal(items[0].name, "shell");
    assert.equal(items[0].call, "$ ls /workspaces");
    assert.equal(items[0].output, "test");
    assert.equal(items[0].status, "completed");
  }
  assert.equal(items[1]?.kind, "tool");
  if (items[1]?.kind === "tool") {
    assert.equal(items[1].name, "write");
    assert.equal(items[1].status, "error");
    assert.equal(items[1].call, "/app/note.md");
    assert.equal(items[1].output, "Unable to write /app/note.md");
  }
  assert.deepEqual(items[2], { kind: "chat", text: "Saved the note." });
  assert.equal(items.some((item) => item.kind === "note" && item.text === "not json"), true);
  assert.equal(items.some((item) => item.kind === "stderr" && item.text.includes("Unrecognized flag")), true);
  assert.deepEqual(items.at(-1), { kind: "meta", text: "1 step · $0.0123" });
});

test("clips a long tool result and points at the raw log", () => {
  const log = JSON.stringify({
    type: "tool_use",
    part: { tool: "read", state: { status: "completed", input: { path: "notes.md" }, output: "x".repeat(2500) } },
  });
  const items = transcriptFromLog(log);
  assert.equal(items[0]?.kind, "tool");
  if (items[0]?.kind === "tool") {
    assert.equal(items[0].call, "notes.md");
    assert.match(items[0].output, /truncated, full text is in the raw log$/);
    assert.ok(items[0].output.length < 2500);
  }
});
