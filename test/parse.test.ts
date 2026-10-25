import assert from "node:assert/strict";
import { test } from "node:test";
import { capText, parseOpencodeOutput } from "../sandbox/parse.js";
import { resolveWorkspace } from "../shared/workspace.js";

test("reads assistant text and session errors from OpenCode json events", () => {
  const stdout = [
    JSON.stringify({ type: "tool_use", part: { tool: "bash" } }),
    JSON.stringify({ type: "text", part: { text: "Morning note" } }),
    JSON.stringify({ type: "error", error: { data: { message: "provider refused" } } }),
    "not json",
  ].join("\n");
  const parsed = parseOpencodeOutput(stdout);
  assert.equal(parsed.summary, "Morning note");
  assert.deepEqual(parsed.errors, ["provider refused"]);
});

test("keeps the end of a long log", () => {
  const text = `${"a".repeat(50)}END`;
  assert.equal(capText(text, 3), "[truncated 50 characters]\nEND");
});

test("resolves a workspace folder and rejects parents", () => {
  assert.equal(resolveWorkspace("/workspaces", "notes"), "/workspaces/notes");
  assert.throws(() => resolveWorkspace("/workspaces", "../etc"), /folder name/);
  assert.throws(() => resolveWorkspace("/workspaces", "/etc"), /folder name/);
});
