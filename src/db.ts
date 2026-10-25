import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { Job, Run, RunStatus } from "./types.js";

const STATUSES = new Set<RunStatus>(["queued", "running", "ok", "failed", "timeout"]);

export type Database = {
  listJobs(): Job[];
  getJob(id: string): Job | undefined;
  insertJob(job: Job): void;
  updateJob(job: Job): void;
  deleteJob(id: string): void;
  insertRun(run: Run): void;
  getRun(id: string): Run | undefined;
  latestRun(jobId: string): Run | undefined;
  latestStartedAt(jobId: string): string | undefined;
  listRuns(jobId: string, limit: number): Run[];
  markRunning(id: string, startedAt: string): void;
  finishRun(run: Pick<Run, "id" | "status" | "finishedAt" | "summary" | "error" | "logPath">): void;
  failStale(finishedAt: string): void;
  activeRun(jobId: string, status: "queued" | "running"): Run | undefined;
  runsBeyond(jobId: string, keep: number): Run[];
  deleteRun(id: string): void;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
  close(): void;
};

export function openDatabase(dataDir: string): Database {
  mkdirSync(path.join(dataDir, "logs"), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "cron.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL,
      timezone TEXT NOT NULL,
      workspace TEXT NOT NULL,
      model TEXT,
      agent TEXT,
      timeout_sec INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      summary TEXT,
      error TEXT,
      log_path TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_job_created ON runs(job_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return {
    listJobs: () => db.prepare("SELECT * FROM jobs ORDER BY name COLLATE NOCASE").all().map(mapJob),
    getJob: (id) => mapOptional(db.prepare("SELECT * FROM jobs WHERE id = ?").get(id), mapJob),
    insertJob: (job) => {
      db.prepare(
        `INSERT INTO jobs (
          id, name, prompt, schedule, timezone, workspace, model, agent, timeout_sec, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        job.id,
        job.name,
        job.prompt,
        job.schedule,
        job.timezone,
        job.workspace,
        job.model,
        job.agent,
        job.timeoutSec,
        job.enabled ? 1 : 0,
        job.createdAt,
        job.updatedAt,
      );
    },
    updateJob: (job) => {
      db.prepare(
        `UPDATE jobs SET
          name = ?, prompt = ?, schedule = ?, timezone = ?, workspace = ?, model = ?, agent = ?,
          timeout_sec = ?, enabled = ?, updated_at = ?
        WHERE id = ?`,
      ).run(
        job.name,
        job.prompt,
        job.schedule,
        job.timezone,
        job.workspace,
        job.model,
        job.agent,
        job.timeoutSec,
        job.enabled ? 1 : 0,
        job.updatedAt,
        job.id,
      );
    },
    deleteJob: (id) => {
      db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
    },
    insertRun: (run) => {
      db.prepare(
        `INSERT INTO runs (id, job_id, status, created_at, started_at, finished_at, summary, error, log_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(run.id, run.jobId, run.status, run.createdAt, run.startedAt, run.finishedAt, run.summary, run.error, run.logPath);
    },
    getRun: (id) => mapOptional(db.prepare("SELECT * FROM runs WHERE id = ?").get(id), mapRun),
    latestRun: (jobId) =>
      mapOptional(db.prepare("SELECT * FROM runs WHERE job_id = ? ORDER BY created_at DESC LIMIT 1").get(jobId), mapRun),
    latestStartedAt: (jobId) => {
      const row = db.prepare(
        "SELECT started_at FROM runs WHERE job_id = ? AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1",
      ).get(jobId);
      return row?.started_at == null ? undefined : String(row.started_at);
    },
    listRuns: (jobId, limit) =>
      db.prepare("SELECT * FROM runs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?").all(jobId, limit).map(mapRun),
    markRunning: (id, startedAt) => {
      db.prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?").run(startedAt, id);
    },
    finishRun: (run) => {
      db.prepare("UPDATE runs SET status = ?, finished_at = ?, summary = ?, error = ?, log_path = ? WHERE id = ?").run(
        run.status,
        run.finishedAt,
        run.summary,
        run.error,
        run.logPath,
        run.id,
      );
    },
    failStale: (finishedAt) => {
      db.prepare(
        "UPDATE runs SET status = 'failed', error = 'Interrupted by restart', finished_at = ? WHERE status IN ('queued', 'running')",
      ).run(finishedAt);
    },
    activeRun: (jobId, status) =>
      mapOptional(
        db.prepare("SELECT * FROM runs WHERE job_id = ? AND status = ? ORDER BY created_at ASC LIMIT 1").get(jobId, status),
        mapRun,
      ),
    runsBeyond: (jobId, keep) =>
      db.prepare(
        `SELECT * FROM runs WHERE job_id = ? AND id NOT IN (
          SELECT id FROM runs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?
        )`,
      ).all(jobId, jobId, keep).map(mapRun),
    deleteRun: (id) => {
      db.prepare("DELETE FROM runs WHERE id = ?").run(id);
    },
    getSetting: (key) => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      return row?.value == null ? null : String(row.value);
    },
    setSetting: (key, value) => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    },
    deleteSetting: (key) => {
      db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    },
    close: () => db.close(),
  };
}

function mapOptional<T>(row: Record<string, SQLOutputValue> | undefined, map: (row: Record<string, SQLOutputValue>) => T): T | undefined {
  return row ? map(row) : undefined;
}

function mapJob(row: Record<string, SQLOutputValue>): Job {
  return {
    id: text(row.id),
    name: text(row.name),
    prompt: text(row.prompt),
    schedule: text(row.schedule),
    timezone: text(row.timezone),
    workspace: text(row.workspace),
    model: optional(row.model),
    agent: optional(row.agent),
    timeoutSec: Number(row.timeout_sec),
    enabled: row.enabled === 1,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapRun(row: Record<string, SQLOutputValue>): Run {
  const status = text(row.status);
  if (!STATUSES.has(status as RunStatus)) throw new Error(`Unknown run status: ${status}`);
  return {
    id: text(row.id),
    jobId: text(row.job_id),
    status: status as RunStatus,
    createdAt: text(row.created_at),
    startedAt: optional(row.started_at),
    finishedAt: optional(row.finished_at),
    summary: optional(row.summary),
    error: optional(row.error),
    logPath: optional(row.log_path),
  };
}

function text(value: SQLOutputValue): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function optional(value: SQLOutputValue): string | null {
  if (value == null) return null;
  return String(value);
}
