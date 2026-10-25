export function parseOpencodeOutput(stdout: string): { summary: string; errors: string[] } {
  const texts: string[] = [];
  const errors: string[] = [];
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
    if (record.type === "text") {
      const text = partText(record.part);
      if (text) texts.push(text);
    }
    if (record.type === "error") errors.push(errorText(record.error));
  }
  return { summary: texts.join("\n\n"), errors };
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
