import { assertWorkspaceName } from "../shared/workspace.js";
import { assertTimezone } from "./config.js";
import { JobError } from "./errors.js";
import { nextScheduled } from "./schedule.js";
import type { JobInput } from "./types.js";

const NAME_LIMIT = 80;
const PROMPT_LIMIT = 100_000;
const FIELD_LIMIT = 200;

export function parseJobInput(raw: Partial<Record<keyof JobInput, unknown>>, fallbackTimezone: string): JobInput {
  return {
    name: requiredText(raw.name, "Name", NAME_LIMIT),
    prompt: requiredText(raw.prompt, "Prompt", PROMPT_LIMIT),
    schedule: assertSchedule(requiredText(raw.schedule, "Schedule", FIELD_LIMIT), timezoneOf(raw.timezone, fallbackTimezone)),
    timezone: timezoneOf(raw.timezone, fallbackTimezone),
    workspace: workspaceOf(raw.workspace),
    model: optionalText(raw.model, "Model"),
    agent: optionalText(raw.agent, "Agent"),
    timeoutSec: timeoutOf(raw.timeoutSec, 900),
    enabled: raw.enabled === undefined ? true : booleanOf(raw.enabled),
  };
}

export function parseJobPatch(
  raw: Partial<Record<keyof JobInput, unknown>>,
  current: JobInput,
): JobInput {
  const timezone = raw.timezone === undefined ? current.timezone : timezoneOf(raw.timezone, current.timezone);
  const scheduleSource = raw.schedule === undefined ? current.schedule : raw.schedule;
  return {
    name: raw.name === undefined ? current.name : requiredText(raw.name, "Name", NAME_LIMIT),
    prompt: raw.prompt === undefined ? current.prompt : requiredText(raw.prompt, "Prompt", PROMPT_LIMIT),
    timezone,
    schedule: assertSchedule(requiredText(scheduleSource, "Schedule", FIELD_LIMIT), timezone),
    workspace: raw.workspace === undefined ? current.workspace : workspaceOf(raw.workspace),
    model: raw.model === undefined ? current.model : optionalText(raw.model, "Model"),
    agent: raw.agent === undefined ? current.agent : optionalText(raw.agent, "Agent"),
    timeoutSec: raw.timeoutSec === undefined ? current.timeoutSec : timeoutOf(raw.timeoutSec, current.timeoutSec),
    enabled: raw.enabled === undefined ? current.enabled : booleanOf(raw.enabled),
  };
}

function timezoneOf(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return assertKnown(fallback);
  if (typeof value !== "string") throw new JobError("Timezone must be text", 400);
  return assertKnown(value.trim());
}

function assertKnown(timeZone: string): string {
  try {
    assertTimezone(timeZone);
  } catch (error) {
    throw new JobError(error instanceof Error ? error.message : "Unknown timezone", 400);
  }
  return timeZone;
}

function workspaceOf(value: unknown): string {
  if (typeof value !== "string") throw new JobError("Workspace is required", 400);
  try {
    return assertWorkspaceName(value);
  } catch (error) {
    throw new JobError(error instanceof Error ? error.message : "Invalid workspace", 400);
  }
}

function assertSchedule(expression: string, timezone: string): string {
  try {
    if (!nextScheduled(expression, timezone)) throw new Error("Cron expression never runs");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid cron expression";
    throw new JobError(message.startsWith("Cron") ? message : `Invalid cron expression: ${message}`, 400);
  }
  return expression;
}

function requiredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string") throw new JobError(`${label} is required`, 400);
  const trimmed = value.trim();
  if (!trimmed) throw new JobError(`${label} is required`, 400);
  if (trimmed.length > limit) throw new JobError(`${label} is too long`, 400);
  return trimmed;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new JobError(`${label} must be text`, 400);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > FIELD_LIMIT) throw new JobError(`${label} is too long`, 400);
  if (trimmed.includes("\n")) throw new JobError(`${label} must be a single line`, 400);
  return trimmed;
}

function timeoutOf(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < 30 || number > 7200) {
    throw new JobError("Timeout must be a whole number of seconds from 30 to 7200", 400);
  }
  return number;
}

function booleanOf(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "on" || value === "1") return true;
  if (value === "false" || value === "off" || value === "0") return false;
  throw new JobError("Enabled must be true or false", 400);
}
