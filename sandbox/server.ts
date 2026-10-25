import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { capText, parseOpencodeOutput } from "./parse.js";
import { resolveWorkspace } from "../shared/workspace.js";

const MAX_BODY = 2_000_000;
const MAX_LOG = 1_000_000;
const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST?.trim() || "0.0.0.0";
const workspaceRoot = process.env.WORKSPACE_ROOT?.trim() || "/workspaces";
const opencodeBin = process.env.OPENCODE_BIN?.trim() || "opencode";
const defaultModel = process.env.DEFAULT_MODEL?.trim() || "";

type RunBody = {
  prompt?: unknown;
  workspace?: unknown;
  model?: unknown;
  agent?: unknown;
  timeoutSec?: unknown;
  apiKey?: unknown;
};

let busy = false;

const server = createServer((req, res) => {
  void handle(req, res);
});

server.listen(port, host, () => {
  console.log(`sandbox listening on ${host}:${port}`);
  if (!process.env.OPENCODE_API_KEY) console.warn("OPENCODE_API_KEY is not set");
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true, goKey: Boolean(process.env.OPENCODE_API_KEY) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/models") {
      send(res, 200, { models: await listModels() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/run") {
      if (busy) {
        send(res, 409, { error: "Sandbox is already running a job" });
        return;
      }
      busy = true;
      try {
        const body = JSON.parse(await readBody(req)) as RunBody;
        send(res, 200, await runJob(body));
      } finally {
        busy = false;
      }
      return;
    }
    send(res, 404, { error: "Not found" });
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : "Bad request" });
  }
}

async function runJob(body: RunBody) {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) throw new Error("Prompt is required");
  if (typeof body.workspace !== "string") throw new Error("Workspace is required");
  const timeoutSec = Number(body.timeoutSec ?? 900);
  if (!Number.isInteger(timeoutSec) || timeoutSec < 30 || timeoutSec > 7200) {
    throw new Error("Timeout must be a whole number of seconds from 30 to 7200");
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : defaultModel;
  const agent = typeof body.agent === "string" && body.agent.trim() ? body.agent.trim() : "";
  const dir = await prepareWorkspace(body.workspace);
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : "";

  const args = ["run", "--auto", "--format", "json"];
  if (model) args.push("--model", model);
  if (agent) args.push("--agent", agent);
  args.push("--", body.prompt);

  return spawnOpencode(args, dir, timeoutSec, apiKey);
}

async function prepareWorkspace(name: string): Promise<string> {
  const dir = resolveWorkspace(workspaceRoot, name);
  await mkdir(dir, { recursive: true });
  const rootReal = await realpath(workspaceRoot);
  const dirReal = await realpath(dir);
  const relative = path.relative(rootReal, dirReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Workspace must stay inside the sandbox workspaces directory");
  }
  return dirReal;
}

function spawnOpencode(args: string[], cwd: string, timeoutSec: number, apiKey = "") {
  return new Promise<{
    ok: boolean;
    timedOut: boolean;
    exitCode: number | null;
    summary: string;
    error: string | null;
    log: string;
  }>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(opencodeBin, args, {
      cwd,
      env: apiKey ? { ...process.env, OPENCODE_API_KEY: apiKey } : process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (exitCode: number | null, spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const parsed = parseOpencodeOutput(stdout);
      const errors = [...parsed.errors];
      if (spawnError) errors.push(spawnError.message);
      if (timedOut) errors.push(`Timed out after ${timeoutSec} seconds`);
      else if (exitCode && exitCode !== 0) errors.push(`OpenCode exited with code ${exitCode}`);
      const log = capText(`# stdout\n${stdout}\n# stderr\n${stderr}`, MAX_LOG);
      resolve({
        ok: !timedOut && !spawnError && exitCode === 0 && parsed.errors.length === 0,
        timedOut,
        exitCode,
        summary: capText(parsed.summary, 20_000),
        error: errors.length ? errors.join("\n") : null,
        log,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill(child.pid);
    }, timeoutSec * 1000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

function listModels(): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(opencodeBin, ["models"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 20_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(
        stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(line)),
      );
    });
  });
}

function append(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > MAX_LOG * 2 ? next.slice(next.length - MAX_LOG * 2) : next;
}

function kill(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        return;
      }
    }
  }, 5000).unref();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
