export function parseOpencodeOutput(stdout: string): { summary: string; errors: string[]; sessionId: string | null } {
  const texts: string[] = [];
  const errors: string[] = [];
  let sessionId: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (!sessionId && typeof record.sessionID === "string" && record.sessionID) sessionId = record.sessionID;
    if (record.type === "text") {
      const text = partText(record.part);
      if (text) texts.push(text);
    }
    if (record.type === "error") errors.push(errorText(record.error));
  }
  return { summary: texts.join("\n\n"), errors, sessionId };
}

export function summaryFromPass(input: {
  timedOut: boolean;
  timeoutSec: number;
  spawnError: string | null;
  exitCode: number | null;
  stdout: string;
}): { summary: string; verdict: Verdict | null; error: string | null } {
  const parsed = parseOpencodeOutput(input.stdout);
  const none = { summary: "", verdict: null };
  if (input.timedOut) return { ...none, error: `Summary timed out after ${input.timeoutSec} seconds` };
  if (input.spawnError) return { ...none, error: `Summary could not start: ${input.spawnError}` };
  if (parsed.errors.length) return { ...none, error: `Summary failed: ${parsed.errors.join("; ")}` };
  const { verdict, summary } = readVerdict(parsed.summary);
  if (!summary && !verdict) {
    return { ...none, error: `Summary returned no text${input.exitCode ? ` (exit code ${input.exitCode})` : ""}` };
  }
  return { summary, verdict, error: null };
}

export type Verdict = "done" | "failed";

const VERDICT_LINE = /^[\s*_`#>]*status\s*:\s*[\s*_`]*(done|failed)\b.*$/i;

export function readVerdict(text: string): { verdict: Verdict | null; summary: string } {
  const lines = text.trim().split(/\r?\n/);
  const match = lines[0]?.match(VERDICT_LINE);
  if (!match?.[1]) return { verdict: null, summary: text.trim() };
  return { verdict: match[1].toLowerCase() as Verdict, summary: lines.slice(1).join("\n").trim() };
}

export function applyVerdict(
  run: { ok: boolean; error: string | null },
  verdict: Verdict | null,
  summary: string,
): { ok: boolean; error: string | null } {
  if (!run.ok || verdict !== "failed") return run;
  const headline = summary.split(/\r?\n/).find((line) => line.trim())?.trim();
  return { ok: false, error: `The agent reported the task was not completed${headline ? `: ${headline}` : ""}` };
}

function partText(part: unknown): string {
  if (!part || typeof part !== "object" || !("text" in part)) return "";
  const text = (part as { text: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown OpenCode error";
  const record = error as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === "object" && "message" in data && typeof (data as { message: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  if (typeof record.message === "string") return record.message;
  if (typeof record.name === "string") return record.name;
  return "Unknown OpenCode error";
}

export function classifyOpencodeRun(input: {
  timedOut: boolean;
  timeoutSec: number;
  spawnError: string | null;
  exitCode: number | null;
  summary: string;
  sessionErrors: string[];
}): { ok: boolean; error: string | null } {
  const messages = [...input.sessionErrors];
  if (input.spawnError) messages.push(input.spawnError);
  // `opencode run` exits 1 when any tool reports an error, and it keeps that code
  // after the agent recovers and finishes. A finished answer with no session error
  // is a successful run.
  const recoveredToolError = input.exitCode === 1 && input.summary.trim().length > 0 && input.sessionErrors.length === 0;
  if (input.timedOut) messages.push(`Timed out after ${input.timeoutSec} seconds`);
  else if (input.exitCode && input.exitCode !== 0 && !recoveredToolError) {
    messages.push(`OpenCode exited with code ${input.exitCode}`);
  }
  const ok = !input.timedOut && !input.spawnError && input.sessionErrors.length === 0 && (input.exitCode === 0 || recoveredToolError);
  return { ok, error: messages.length ? messages.join("\n") : null };
}

export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const omitted = text.length - max;
  return `[truncated ${omitted} characters]\n${text.slice(text.length - max)}`;
}
