export type Job = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  workspace: string;
  model: string | null;
  agent: string | null;
  timeoutSec: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RunStatus = "queued" | "running" | "ok" | "failed" | "timeout";

export type Run = {
  id: string;
  jobId: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  logPath: string | null;
};

export type JobInput = {
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  workspace: string;
  model: string | null;
  agent: string | null;
  timeoutSec: number;
  enabled: boolean;
};

export type LastRun = {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
};

export type JobView = Job & {
  nextRun: string | null;
  lastRun: LastRun | null;
};

export type SandboxRequest = {
  prompt: string;
  workspace: string;
  model?: string;
  agent?: string;
  timeoutSec: number;
  apiKey?: string;
};

export type ServerSettings = {
  timezone: string;
  defaultModel: string | null;
  goConnected: boolean;
  goSource: "saved" | "environment" | null;
  goKeyHint: string | null;
  models: string[];
  modelsError: string | null;
};

export type SandboxResult = {
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  summary: string;
  error: string | null;
  log: string;
};
