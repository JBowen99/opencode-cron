import type { SandboxRequest, SandboxResult } from "./types.js";

export async function sandboxGoConnected(sandboxUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${sandboxUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { goKey?: unknown };
    return body.goKey === true;
  } catch {
    return false;
  }
}

export async function listSandboxModels(sandboxUrl: string): Promise<string[]> {
  try {
    const response = await fetch(`${sandboxUrl}/models`, { signal: AbortSignal.timeout(25_000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { models?: unknown };
    if (!Array.isArray(body.models)) return [];
    return body.models.filter((model): model is string => typeof model === "string");
  } catch {
    return [];
  }
}

export async function runInSandbox(sandboxUrl: string, input: SandboxRequest): Promise<SandboxResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (input.timeoutSec + 30) * 1000);
  try {
    const response = await fetch(`${sandboxUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return failed(`Sandbox returned ${response.status}: ${text.slice(0, 500)}`);
    }
    const parsed = JSON.parse(text) as Partial<SandboxResult>;
    return {
      ok: parsed.ok === true,
      timedOut: parsed.timedOut === true,
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      error: typeof parsed.error === "string" ? parsed.error : null,
      log: typeof parsed.log === "string" ? parsed.log : text,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return failed(aborted ? "Sandbox timed out" : `Sandbox unreachable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

function failed(message: string): SandboxResult {
  return { ok: false, timedOut: false, exitCode: null, summary: "", error: message, log: message };
}
