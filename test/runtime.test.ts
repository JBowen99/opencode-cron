import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { loadConfig } from "../src/config.js";
import { createRuntime, type Runner } from "../src/runtime.js";
import type { SandboxResult } from "../src/types.js";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("rejects a workspace path that leaves the sandbox", () => {
  const runtime = runtimeAt(temp(), async () => okResult("unused"));
  try {
    assert.throws(() => runtime.createJob(sample({ workspace: "../secrets" })), /folder name/);
  } finally {
    runtime.close();
  }
});

test("runs a job through the queue and keeps the summary", async () => {
  const seen: string[] = [];
  const runtime = runtimeAt(temp(), async (input) => {
    seen.push(input.workspace);
    return okResult(`finished ${input.prompt}`);
  });
  try {
    const job = runtime.createJob(sample({}));
    const run = runtime.requestRun(job.id);
    await runtime.whenIdle();
    const loaded = runtime.getRun(run.id);
    assert.equal(seen.length, 1);
    assert.equal(loaded.run.status, "ok");
    assert.equal(loaded.run.summary, "finished check the inbox");
    assert.match(loaded.log, /finished check the inbox/);
  } finally {
    runtime.close();
  }
});

test("catches up one missed run on startup", async () => {
  const dataDir = temp();
  let calls = 0;
  const runner: Runner = async () => {
    calls += 1;
    return okResult("caught up");
  };
  const created = runtimeAt(dataDir, runner);
  let jobId = "";
  try {
    jobId = created.createJob(sample({ schedule: "0 9 * * *" })).id;
  } finally {
    created.close();
  }

  const db = new DatabaseSync(path.join(dataDir, "cron.db"));
  db.prepare("UPDATE jobs SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), jobId);
  db.close();

  const booted = runtimeAt(dataDir, runner);
  try {
    booted.start();
    await booted.whenIdle();
    assert.equal(calls, 1);
    const runs = booted.listRuns(jobId);
    assert.equal(runs[0]?.status, "ok");
    assert.equal(runs[0]?.summary, "caught up");
  } finally {
    booted.close();
  }
});

function runtimeAt(dataDir: string, runner: Runner) {
  const config = loadConfig({
    CRON_TOKEN: "test-token-value",
    DATA_DIR: dataDir,
    DEFAULT_TIMEZONE: "UTC",
    SANDBOX_URL: "http://127.0.0.1:9",
  });
  return createRuntime(config, runner);
}

function sample(overrides: Record<string, string>) {
  return {
    name: "Inbox",
    prompt: "check the inbox",
    schedule: "0 8 * * 1-5",
    timezone: "UTC",
    workspace: "notes",
    ...overrides,
  };
}

function okResult(summary: string): SandboxResult {
  return { ok: true, timedOut: false, exitCode: 0, summary, error: null, log: summary };
}

function temp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-cron-"));
  dirs.push(dir);
  return dir;
}
