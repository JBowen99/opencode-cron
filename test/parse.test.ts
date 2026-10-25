import assert from "node:assert/strict";
import { test } from "node:test";
import { capText, classifyOpencodeRun, parseOpencodeOutput } from "../sandbox/parse.js";
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

test("treats a finished answer as success when OpenCode exits 1 after a tool error", () => {
  const result = classifyOpencodeRun({
    timedOut: false,
    timeoutSec: 900,
    spawnError: null,
    exitCode: 1,
    summary: "Updated jobs.md with the new run.",
    sessionErrors: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
});

test("still fails a non-zero exit that produced no answer", () => {
  const result = classifyOpencodeRun({
    timedOut: false,
    timeoutSec: 900,
    spawnError: null,
    exitCode: 1,
    summary: "",
    sessionErrors: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "OpenCode exited with code 1");
});

test("still fails when OpenCode reports a session error", () => {
  const result = classifyOpencodeRun({
    timedOut: false,
    timeoutSec: 900,
    spawnError: null,
    exitCode: 1,
    summary: "Partial note",
    sessionErrors: ["provider refused"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "provider refused\nOpenCode exited with code 1");
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
