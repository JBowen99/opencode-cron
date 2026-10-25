import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import { z } from "zod";
import { publicJob, publicRun, type Runtime } from "./runtime.js";

const workspace = z.string().describe("Folder name inside the sandbox volume on the home server, not a path on the client machine");

export function mountMcp(app: Hono, runtime: Runtime): void {
  app.all("/mcp", async (c) => {
    if (c.req.method === "GET") {
      return c.text("SSE stream is not offered", 405, { allow: "POST, DELETE" });
    }
    const server = new McpServer({ name: "opencode-cron", version: "0.1.0" });
    register(server, runtime);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close().catch(() => undefined);
    }
  });
}

function register(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    "list_jobs",
    {
      title: "List jobs",
      description: "List scheduled OpenCode jobs on the home server, including the next run and the latest status.",
      annotations: { readOnlyHint: true },
    },
    async () => text(runtime.listJobs().map(publicJob)),
  );

  server.registerTool(
    "get_job",
    {
      title: "Get job",
      description: "Get one scheduled job by id.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => text(publicJob(runtime.getJob(id))),
  );

  server.registerTool(
    "create_job",
    {
      title: "Create job",
      description:
        "Create a scheduled job. The workspace is a folder name inside the sandbox volume on the home server. The schedule is a five-field cron expression.",
      inputSchema: {
        name: z.string(),
        prompt: z.string().describe("Instructions the OpenCode agent runs on the home server"),
        schedule: z.string().describe("Five-field cron expression, for example 0 8 * * 1-5"),
        timezone: z.string().describe("IANA timezone, for example America/Denver"),
        workspace,
        model: z.string().optional().describe("provider/model. Omit to use the server default"),
        agent: z.string().optional(),
        timeoutSec: z.number().int().min(30).max(7200).optional(),
        enabled: z.boolean().optional(),
      },
    },
    async (input) => text(publicJob(runtime.createJob(input))),
  );

  server.registerTool(
    "update_job",
    {
      title: "Update job",
      description: "Change fields on an existing job. Omit fields that should stay the same.",
      inputSchema: {
        id: z.string(),
        name: z.string().optional(),
        prompt: z.string().optional(),
        schedule: z.string().optional(),
        timezone: z.string().optional(),
        workspace: workspace.optional(),
        model: z.string().nullable().optional(),
        agent: z.string().nullable().optional(),
        timeoutSec: z.number().int().min(30).max(7200).optional(),
        enabled: z.boolean().optional(),
      },
    },
    async ({ id, ...patch }) => text(publicJob(runtime.updateJob(id, patch))),
  );

  server.registerTool(
    "delete_job",
    {
      title: "Delete job",
      description: "Delete a job and its run history. Refuses while a run is in progress.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      runtime.deleteJob(id);
      return text({ deleted: id });
    },
  );

  server.registerTool(
    "set_enabled",
    {
      title: "Pause or resume job",
      description: "Enable or pause a job without deleting it.",
      inputSchema: { id: z.string(), enabled: z.boolean() },
    },
    async ({ id, enabled }) => text(publicJob(runtime.setEnabled(id, enabled))),
  );

  server.registerTool(
    "run_now",
    {
      title: "Run job now",
      description: "Queue the job to run once on the home server. One run executes at a time.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => text(publicRun(runtime.requestRun(id))),
  );

  server.registerTool(
    "list_runs",
    {
      title: "List runs",
      description: "List recent runs for a job, newest first.",
      inputSchema: { jobId: z.string(), limit: z.number().int().min(1).max(50).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ jobId, limit }) => text(runtime.listRuns(jobId, limit ?? 20).map(publicRun)),
  );

  server.registerTool(
    "get_run",
    {
      title: "Get run",
      description: "Get one run, including its summary and a capped log.",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const loaded = runtime.getRun(id);
      const log = loaded.log.length > 20_000 ? `${loaded.log.slice(0, 20_000)}\n[log truncated]` : loaded.log;
      return text({ ...publicRun(loaded.run), log });
    },
  );
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
