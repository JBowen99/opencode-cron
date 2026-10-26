import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { SUMMARY_TIMEOUT_SEC } from "../shared/summary.js";
import { runInSandbox } from "../src/sandbox-client.js";
import type { SandboxRequest } from "../src/types.js";

test("runs a job against the sandbox", async () => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { prompt?: string };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, timedOut: false, exitCode: 0, summary: body.prompt, error: null, log: "done" }));
    });
  });
  await listen(server);
  try {
    const result = await runInSandbox(url(server), request());
    assert.equal(result.ok, true);
    assert.equal(result.summary, "check the inbox");
    assert.equal(result.log, "done");
  } finally {
    server.close();
  }
});

test("includes the refused connection in the sandbox error", async () => {
  const server = createServer();
  await listen(server);
  const address = url(server);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const result = await runInSandbox(address, request());
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Sandbox unreachable: connect ECONNREFUSED/);
});

test("reports a timeout when the sandbox never answers", async () => {
  const server = createServer(() => {});
  await listen(server);
  try {
    const result = await runInSandbox(url(server), request(-29 - SUMMARY_TIMEOUT_SEC));
    assert.equal(result.error, "Sandbox timed out");
  } finally {
    server.close();
  }
});

function request(timeoutSec = 30): SandboxRequest {
  return { prompt: "check the inbox", workspace: "notes", timeoutSec };
}

function url(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
