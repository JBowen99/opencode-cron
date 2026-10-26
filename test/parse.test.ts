import assert from "node:assert/strict";
import { test } from "node:test";
import { applyVerdict, capText, classifyOpencodeRun, parseOpencodeOutput, readVerdict, summaryFromPass } from "../sandbox/parse.js";
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

test("reads the session id so the summary pass can continue the session", () => {
  const stdout = [
    "starting",
    JSON.stringify({ type: "text", sessionID: "ses_abc", part: { text: "ok", sessionID: "ses_abc" } }),
  ].join("\n");
  assert.equal(parseOpencodeOutput(stdout).sessionId, "ses_abc");
  assert.equal(parseOpencodeOutput("not json").sessionId, null);
});

test("uses the summary pass text when it finishes cleanly", () => {
  const stdout = JSON.stringify({ type: "text", sessionID: "ses_abc", part: { text: "STATUS: done\nFiled 3 invoices.\n- invoices.md" } });
  const result = summaryFromPass({ timedOut: false, timeoutSec: 120, spawnError: null, exitCode: 0, stdout });
  assert.deepEqual(result, { summary: "Filed 3 invoices.\n- invoices.md", verdict: "done", error: null });
});

test("reads the status line even when the model formats it", () => {
  assert.deepEqual(readVerdict("**STATUS: Failed**\nLogin was rejected."), { verdict: "failed", summary: "Login was rejected." });
  assert.deepEqual(readVerdict("Status: done."), { verdict: "done", summary: "" });
  assert.deepEqual(readVerdict("Filed 3 invoices."), { verdict: null, summary: "Filed 3 invoices." });
  assert.deepEqual(readVerdict("The status: done part is later"), { verdict: null, summary: "The status: done part is later" });
});

test("lets the agent's verdict fail a run but never rescue one", () => {
  const ok = { ok: true, error: null };
  const crashed = { ok: false, error: "provider refused" };
  assert.deepEqual(applyVerdict(ok, "failed", "Could not read the inbox.\n- login rejected"), {
    ok: false,
    error: "The agent reported the task was not completed: Could not read the inbox.",
  });
  assert.deepEqual(applyVerdict(ok, "done", "Filed 3 invoices."), ok);
  assert.deepEqual(applyVerdict(ok, null, "Filed 3 invoices."), ok);
  assert.deepEqual(applyVerdict(crashed, "done", "All good."), crashed);
});

test("reports why the summary pass produced nothing", () => {
  const base = { timedOut: false, timeoutSec: 120, spawnError: null, exitCode: 0, stdout: "" };
  assert.equal(summaryFromPass({ ...base, timedOut: true }).error, "Summary timed out after 120 seconds");
  assert.equal(summaryFromPass({ ...base, spawnError: "ENOENT" }).error, "Summary could not start: ENOENT");
  assert.equal(
    summaryFromPass({ ...base, stdout: JSON.stringify({ type: "error", error: { message: "rate limited" } }) }).error,
    "Summary failed: rate limited",
  );
  assert.equal(summaryFromPass({ ...base, exitCode: 1 }).error, "Summary returned no text (exit code 1)");
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
