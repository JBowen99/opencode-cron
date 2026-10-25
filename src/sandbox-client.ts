import type { SandboxRequest, SandboxResult } from "./types.js";

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
