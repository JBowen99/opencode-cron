import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { loadConfig } from "../src/config.js";
import { JobError } from "../src/errors.js";
import { modelIdsFromCatalog } from "../src/go-models.js";
import { createRuntime, type GoModels, type Runner } from "../src/runtime.js";
import type { SandboxRequest, SandboxResult } from "../src/types.js";

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

test("connects Go and uses the saved timezone and model", async () => {
  const seen: SandboxRequest[] = [];
  const goModels: GoModels = async (apiKey) => {
    if (apiKey === "rejected-key-value") throw new JobError("OpenCode Go rejected that API key", 401);
    return ["opencode-go/kimi-k3", "opencode/big-pickle"];
  };
  const runtime = runtimeAt(
    temp(),
    async (input) => {
      seen.push(input);
      return okResult("ran");
    },
    goModels,
  );
  try {
    await assert.rejects(() => runtime.connectGo("rejected-key-value"), /rejected/);
    const rejected = await runtime.getSettings();
    assert.equal(rejected.goConnected, false);
    assert.equal(JSON.stringify(rejected).includes("rejected-key-value"), false);

    const connected = await runtime.connectGo("oc_test_key_1234");
    assert.equal(connected.goSource, "saved");
    assert.equal(connected.goKeyHint, "1234");
    assert.deepEqual(connected.models, ["opencode-go/kimi-k3"]);
    assert.equal(JSON.stringify(connected).includes("oc_test_key_1234"), false);

    await runtime.updateSettings({ timezone: "America/Denver", defaultModel: "opencode-go/kimi-k3" });
    const job = runtime.createJob({
      name: "Inbox",
      prompt: "check the inbox",
      schedule: "0 8 * * 1-5",
      workspace: "notes",
    });
    assert.equal(job.timezone, "America/Denver");
    runtime.requestRun(job.id);
    await runtime.whenIdle();
    assert.equal(seen[0]?.model, "opencode-go/kimi-k3");
    assert.equal(seen[0]?.apiKey, "oc_test_key_1234");

    const cleared = await runtime.disconnectGo();
    assert.equal(cleared.goConnected, false);
    assert.equal(cleared.goKeyHint, null);
    await assert.rejects(() => runtime.updateSettings({ timezone: "Not/AZone" }), /Unknown timezone/);
  } finally {
    runtime.close();
  }
});

test("reads Go model ids from the catalog", () => {
  assert.deepEqual(modelIdsFromCatalog({ data: [{ id: "kimi-k3" }, { id: "opencode-go/glm-5.3" }, { id: "" }] }), [
    "opencode-go/glm-5.3",
    "opencode-go/kimi-k3",
  ]);
});

function runtimeAt(dataDir: string, runner: Runner, goModels?: GoModels) {
  const config = loadConfig({
    CRON_TOKEN: "test-token-value",
    DATA_DIR: dataDir,
    DEFAULT_TIMEZONE: "UTC",
    SANDBOX_URL: "http://127.0.0.1:9",
  });
  return createRuntime(config, runner, goModels);
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
  const dir = mkdtempSync(path.join(tmpdir(), "opencron-"));
  dirs.push(dir);
  return dir;
}
