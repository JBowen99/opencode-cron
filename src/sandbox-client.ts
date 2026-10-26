import { request as httpRequest, type IncomingMessage } from "node:http";
import { SUMMARY_TIMEOUT_SEC } from "../shared/summary.js";
import type { SandboxRequest, SandboxResult } from "./types.js";

const RETRYABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

export async function sandboxStatus(sandboxUrl: string): Promise<string> {
  try {
    const response = await sandboxFetch(`${sandboxUrl}/health`, { timeoutMs: 2000 });
    if (!response.ok) return `sandbox ${sandboxUrl} returned ${response.status}`;
    return `sandbox ${sandboxUrl} is reachable`;
  } catch (error) {
    return `sandbox ${sandboxUrl} is unreachable: ${detail(error)}`;
  }
}

export async function sandboxGoConnected(sandboxUrl: string): Promise<boolean> {
  try {
    const response = await sandboxFetch(`${sandboxUrl}/health`, { timeoutMs: 2000 });
    if (!response.ok) return false;
    const body = JSON.parse(response.text) as { goKey?: unknown };
    return body.goKey === true;
  } catch {
    return false;
  }
}

export async function listSandboxModels(sandboxUrl: string): Promise<string[]> {
  try {
    const response = await sandboxFetch(`${sandboxUrl}/models`, { timeoutMs: 25_000 });
    if (!response.ok) return [];
    const body = JSON.parse(response.text) as { models?: unknown };
    if (!Array.isArray(body.models)) return [];
    return body.models.filter((model): model is string => typeof model === "string");
  } catch {
    return [];
  }
}

export async function runInSandbox(sandboxUrl: string, input: SandboxRequest): Promise<SandboxResult> {
  try {
    const response = await sandboxFetch(`${sandboxUrl}/run`, {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: Math.max(1, Math.round((input.timeoutSec + SUMMARY_TIMEOUT_SEC + 30) * 1000)),
      retries: 2,
    });
    if (!response.ok) {
      return failed(`Sandbox returned ${response.status}: ${response.text.slice(0, 500)}`);
    }
    const parsed = JSON.parse(response.text) as Partial<SandboxResult>;
    return {
      ok: parsed.ok === true,
      timedOut: parsed.timedOut === true,
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      error: typeof parsed.error === "string" ? parsed.error : null,
      log: typeof parsed.log === "string" ? parsed.log : response.text,
    };
  } catch (error) {
    return failed(isTimeout(error) ? "Sandbox timed out" : `Sandbox unreachable: ${detail(error)}`);
  }
}

type HttpText = { ok: boolean; status: number; text: string };

async function sandboxFetch(
  url: string,
  init: { method?: string; body?: string; timeoutMs: number; retries?: number },
): Promise<HttpText> {
  const attempts = (init.retries ?? 0) + 1;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await once(url, init);
    } catch (error) {
      last = error;
      if (isTimeout(error) || attempt === attempts - 1 || !isRetryable(error)) throw error;
      await delay(250 * (attempt + 1));
    }
  }
  throw last;
}

function once(url: string, init: { method?: string; body?: string; timeoutMs: number }): Promise<HttpText> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = init.body;
    const req = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? Number(target.port) : undefined,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "GET",
        // The sandbox listens on IPv4. Node's fetch follows Docker's IPv6 answer and then reports only "fetch failed".
        family: 4,
        headers:
          body === undefined
            ? undefined
            : { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        signal: AbortSignal.timeout(init.timeoutMs),
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 500;
          resolve({ ok: status >= 200 && status < 300, status, text: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function isRetryable(error: unknown): boolean {
  return error instanceof Error && "code" in error && RETRYABLE.has(String(error.code));
}

function detail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) return cause.message;
  if (cause && typeof cause === "object" && "errors" in cause && Array.isArray(cause.errors)) {
    const messages = cause.errors
      .filter((item): item is Error => item instanceof Error && item.message.length > 0)
      .map((item) => item.message);
    if (messages.length) return messages.join("; ");
  }
  return error.message;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failed(message: string): SandboxResult {
  return { ok: false, timedOut: false, exitCode: null, summary: "", error: message, log: message };
}
