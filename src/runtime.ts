import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import type { Config } from "./config.js";
import { openDatabase, type Database } from "./db.js";
import { JobError } from "./errors.js";
import { listGoModels, preferGoModels } from "./go-models.js";
import { listSandboxModels, runInSandbox, sandboxGoConnected } from "./sandbox-client.js";
import { nextScheduled, previousScheduled } from "./schedule.js";
import type { Job, JobInput, JobView, Run, SandboxRequest, SandboxResult, ServerSettings } from "./types.js";
import { parseGoKey, parseJobInput, parseJobPatch, parseSettingsUpdate } from "./validate.js";

const KEEP_RUNS = 50;
const SUMMARY_LIMIT = 20_000;

export type Runner = (input: SandboxRequest) => Promise<SandboxResult>;

export type GoModels = (apiKey: string) => Promise<string[]>;

export type Runtime = {
  listJobs(): JobView[];
  getJob(id: string): JobView;
  createJob(raw: Partial<Record<keyof JobInput, unknown>>): JobView;
  updateJob(id: string, raw: Partial<Record<keyof JobInput, unknown>>): JobView;
  deleteJob(id: string): void;
  setEnabled(id: string, enabled: boolean): JobView;
  requestRun(jobId: string): Run;
  listRuns(jobId: string, limit?: number): Run[];
  getRun(id: string): { run: Run; job: Job; log: string };
  defaults(): { timezone: string; defaultModel: string | null };
  getSettings(): Promise<ServerSettings>;
  updateSettings(raw: { timezone?: unknown; defaultModel?: unknown }): Promise<ServerSettings>;
  connectGo(apiKey: unknown): Promise<ServerSettings>;
  disconnectGo(): Promise<ServerSettings>;
  start(): void;
  stop(): void;
  whenIdle(): Promise<void>;
  close(): void;
};

export function createRuntime(config: Config, runner?: Runner, goModels: GoModels = listGoModels): Runtime {
  const db = openDatabase(config.dataDir);
  const execute = runner ?? ((input: SandboxRequest) => runInSandbox(config.sandboxUrl, input));
  const timers = new Map<string, Cron>();
  const queue: string[] = [];
  let pumping = false;
  let idle: Promise<void> = Promise.resolve();

  function view(job: Job): JobView {
    const last = db.latestRun(job.id);
    return {
      ...job,
      nextRun: job.enabled ? nextRun(job) : null,
      lastRun: last
        ? { id: last.id, status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt }
        : null,
    };
  }

  function requireJob(id: string): Job {
    const job = db.getJob(id);
    if (!job) throw new JobError("Job not found", 404);
    return job;
  }

  function arm(job: Job): void {
    disarm(job.id);
    if (!job.enabled) return;
    const cron = new Cron(job.schedule, { timezone: job.timezone, protect: true, name: job.id, unref: true }, () => {
      try {
        requestRun(job.id);
      } catch (error) {
        console.error(`schedule failed for ${job.id}:`, error instanceof Error ? error.message : error);
      }
    });
    timers.set(job.id, cron);
  }

  function disarm(id: string): void {
    timers.get(id)?.stop();
    timers.delete(id);
  }

  function requestRun(jobId: string): Run {
    requireJob(jobId);
    const queued = db.activeRun(jobId, "queued");
    if (queued) return queued;
    const now = new Date().toISOString();
    const run: Run = {
      id: randomUUID(),
      jobId,
      status: "queued",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      summary: null,
      error: null,
      logPath: null,
    };
    db.insertRun(run);
    queue.push(run.id);
    void pump();
    return run;
  }

  function pump(): Promise<void> {
    if (pumping) return idle;
    pumping = true;
    idle = (async () => {
      try {
        while (queue.length > 0) {
          const runId = queue.shift();
          if (!runId) break;
          await executeRun(runId);
        }
      } finally {
        pumping = false;
      }
    })();
    return idle;
  }

  async function executeRun(runId: string): Promise<void> {
    const existing = db.getRun(runId);
    if (!existing || existing.status !== "queued") return;
    const job = db.getJob(existing.jobId);
    if (!job) {
      db.finishRun({
        id: runId,
        status: "failed",
        finishedAt: new Date().toISOString(),
        summary: null,
        error: "Job was deleted",
        logPath: null,
      });
      return;
    }

    const startedAt = new Date().toISOString();
    db.markRunning(runId, startedAt);
    console.log(`run ${runId} started for job ${job.id}`);
    try {
      const chosen = defaults();
      const model = job.model ?? chosen.defaultModel;
      const apiKey = db.getSetting("go_api_key");
      const result = await execute({
        prompt: job.prompt,
        workspace: job.workspace,
        ...(model ? { model } : {}),
        ...(job.agent ? { agent: job.agent } : {}),
        timeoutSec: job.timeoutSec,
        ...(apiKey ? { apiKey } : {}),
      });
      const logPath = writeLog(config.dataDir, runId, result.log);
      const summary = result.summary.trim().slice(0, SUMMARY_LIMIT) || null;
      db.finishRun({
        id: runId,
        status: result.timedOut ? "timeout" : result.ok ? "ok" : "failed",
        finishedAt: new Date().toISOString(),
        summary,
        error: result.error,
        logPath,
      });
      console.log(`run ${runId} finished ${result.timedOut ? "timeout" : result.ok ? "ok" : "failed"}`);
    } catch (error) {
      db.finishRun({
        id: runId,
        status: "failed",
        finishedAt: new Date().toISOString(),
        summary: null,
        error: error instanceof Error ? error.message : String(error),
        logPath: null,
      });
      console.error(`run ${runId} failed:`, error instanceof Error ? error.message : error);
    }
    prune(job.id);
  }

  function prune(jobId: string): void {
    for (const run of db.runsBeyond(jobId, KEEP_RUNS)) {
      if (run.logPath) rmSync(run.logPath, { force: true });
      db.deleteRun(run.id);
    }
  }

  function catchUp(job: Job): void {
    const previous = previousScheduled(job.schedule, job.timezone);
    if (!previous) return;
    if (previous.getTime() <= Date.parse(job.createdAt)) return;
    const last = db.latestStartedAt(job.id);
    if (last && Date.parse(last) >= previous.getTime()) return;
    requestRun(job.id);
  }

  function saveNew(input: JobInput): Job {
    const now = new Date().toISOString();
    const job: Job = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    db.insertJob(job);
    arm(job);
    return job;
  }

  function defaults(): { timezone: string; defaultModel: string | null } {
    return {
      timezone: db.getSetting("timezone") || config.defaultTimezone,
      defaultModel: db.getSetting("default_model") || config.defaultModel,
    };
  }

  async function getSettings(): Promise<ServerSettings> {
    const savedKey = db.getSetting("go_api_key");
    const chosen = defaults();
    let models: string[] = [];
    let modelsError: string | null = null;
    let goSource: ServerSettings["goSource"] = null;
    if (savedKey) {
      goSource = "saved";
      try {
        models = preferGoModels(await goModels(savedKey));
      } catch (error) {
        modelsError = error instanceof Error ? error.message : "Could not list OpenCode Go models";
      }
    } else if (await sandboxGoConnected(config.sandboxUrl)) {
      goSource = "environment";
      models = preferGoModels(await listSandboxModels(config.sandboxUrl));
      if (!models.length) modelsError = "The server environment key is set, but OpenCode returned no Go models";
    }
    return {
      timezone: chosen.timezone,
      defaultModel: chosen.defaultModel,
      goConnected: goSource !== null,
      goSource,
      goKeyHint: savedKey && savedKey.length >= 8 ? savedKey.slice(-4) : null,
      models,
      modelsError,
    };
  }

  return {
    listJobs: () => db.listJobs().map(view),
    getJob: (id) => view(requireJob(id)),
    createJob: (raw) => view(saveNew(parseJobInput(raw, defaults().timezone))),
    updateJob: (id, raw) => {
      const current = requireJob(id);
      const input = parseJobPatch(raw, toInput(current));
      const job = { ...current, ...input, updatedAt: new Date().toISOString() };
      db.updateJob(job);
      arm(job);
      return view(job);
    },
    deleteJob: (id) => {
      requireJob(id);
      if (db.activeRun(id, "running")) throw new JobError("Job is running", 409);
      for (const run of db.listRuns(id, 1000)) {
        if (run.logPath) rmSync(run.logPath, { force: true });
      }
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const queued = queue[index];
        if (!queued) continue;
        const run = db.getRun(queued);
        if (run?.jobId === id) queue.splice(index, 1);
      }
      disarm(id);
      db.deleteJob(id);
    },
    setEnabled: (id, enabled) => {
      const current = requireJob(id);
      const job = { ...current, enabled, updatedAt: new Date().toISOString() };
      db.updateJob(job);
      arm(job);
      return view(job);
    },
    requestRun,
    listRuns: (jobId, limit = 50) => {
      requireJob(jobId);
      const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 50;
      return db.listRuns(jobId, bounded);
    },
    getRun: (id) => {
      const run = db.getRun(id);
      if (!run) throw new JobError("Run not found", 404);
      const job = requireJob(run.jobId);
      let log = "";
      if (run.logPath) {
        try {
          log = readFileSync(run.logPath, "utf8");
        } catch {
          log = "(log file missing)";
        }
      }
      return { run, job, log };
    },
    defaults,
    getSettings,
    updateSettings: async (raw) => {
      const parsed = parseSettingsUpdate(raw);
      if (parsed.timezone) db.setSetting("timezone", parsed.timezone);
      if (parsed.defaultModel === null) db.deleteSetting("default_model");
      else if (parsed.defaultModel) db.setSetting("default_model", parsed.defaultModel);
      return getSettings();
    },
    connectGo: async (apiKey) => {
      const key = parseGoKey(apiKey);
      const models = preferGoModels(await goModels(key));
      db.setSetting("go_api_key", key);
      const settings = await getSettings();
      return { ...settings, models: models.length ? models : settings.models, modelsError: null };
    },
    disconnectGo: async () => {
      db.deleteSetting("go_api_key");
      return getSettings();
    },
    start: () => {
      db.failStale(new Date().toISOString());
      for (const job of db.listJobs()) {
        if (!job.enabled) continue;
        catchUp(job);
        arm(job);
      }
    },
    stop: () => {
      for (const id of [...timers.keys()]) disarm(id);
    },
    whenIdle: () => idle,
    close: () => {
      for (const id of [...timers.keys()]) disarm(id);
      db.close();
    },
  };
}

function toInput(job: Job): JobInput {
  return {
    name: job.name,
    prompt: job.prompt,
    schedule: job.schedule,
    timezone: job.timezone,
    workspace: job.workspace,
    model: job.model,
    agent: job.agent,
    timeoutSec: job.timeoutSec,
    enabled: job.enabled,
  };
}

function nextRun(job: Job): string | null {
  try {
    return nextScheduled(job.schedule, job.timezone)?.toISOString() ?? null;
  } catch {
    return null;
  }
}

function writeLog(dataDir: string, runId: string, log: string): string {
  const dir = path.join(dataDir, "logs");
  mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, `${runId}.log`);
  writeFileSync(logPath, log);
  return logPath;
}

export function publicJob(job: JobView) {
  return {
    id: job.id,
    name: job.name,
    prompt: job.prompt,
    schedule: job.schedule,
    timezone: job.timezone,
    workspace: job.workspace,
    model: job.model,
    agent: job.agent,
    timeoutSec: job.timeoutSec,
    enabled: job.enabled,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    nextRun: job.nextRun,
    lastRun: job.lastRun,
  };
}

export function publicRun(run: Run) {
  return {
    id: run.id,
    jobId: run.jobId,
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    error: run.error,
  };
}
