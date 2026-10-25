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
    const server = new McpServer({ name: "OpenCron", version: "0.1.0" }, { instructions: CRON_INSTRUCTIONS });
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
  server.registerPrompt(
    "cron",
    {
      title: "Cron",
      description:
        "Create, list, inspect, pause, and run scheduled OpenCode jobs on the home server. Also connect OpenCode Go, set the timezone, and choose the default model.",
      argsSchema: { request: z.string().describe("What the user wants done with scheduled jobs") },
    },
    async ({ request }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `${CRON_INSTRUCTIONS}\n\nThe user's request is:\n\n${request}` },
        },
      ],
    }),
  );

  server.registerTool(
    "get_settings",
    {
      title: "Get settings",
      description:
        "Show whether OpenCode Go is connected, the timezone, and the default model. Does not return the API key.",
      annotations: { readOnlyHint: true },
    },
    async () => text(await runtime.getSettings()),
  );

  server.registerTool(
    "connect_go",
    {
      title: "Connect OpenCode Go",
      description:
        "Save an OpenCode Go API key on the home server and check it against the Go model list. The key is not returned. Ask the user for a key from the OpenCode Console under Account, Personal API keys.",
      inputSchema: { apiKey: z.string().describe("OpenCode Go API key. Do not echo this value back to the user.") },
    },
    async ({ apiKey }) => text(await runtime.connectGo(apiKey)),
  );

  server.registerTool(
    "disconnect_go",
    {
      title: "Disconnect OpenCode Go",
      description: "Remove the OpenCode Go API key saved on the home server. A key set in the server environment is left in place.",
      annotations: { destructiveHint: true },
    },
    async () => text(await runtime.disconnectGo()),
  );

  server.registerTool(
    "update_settings",
    {
      title: "Update timezone or default model",
      description:
        "Set the server timezone or default model. Omit a field to leave it unchanged. An empty default model clears the saved model. Model ids look like opencode-go/kimi-k3.",
      inputSchema: {
        timezone: z.string().optional().describe("IANA timezone, for example America/Denver"),
        defaultModel: z.string().nullable().optional().describe("provider/model, or empty to clear"),
      },
    },
    async (input) => text(await runtime.updateSettings(input)),
  );

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

const CRON_INSTRUCTIONS = `You manage scheduled jobs on the home OpenCron service through the opencron MCP tools. Workspace values are folder names inside the sandbox volume on the home server, not paths on this computer. The agent that runs a job can use tools only inside that sandbox.

## Setup

Use this when the user wants to connect OpenCode Go, choose a timezone, or choose the default model.

- Call get_settings before changing anything.
- To connect, ask for the Go API key from the OpenCode Console under Account, then Personal API keys. Pass it to connect_go. Confirm that Go is connected and mention the key hint only. Do not repeat the full key.
- To disconnect, call disconnect_go only after the user asks.
- To set the timezone or default model, call update_settings. Use the model list from get_settings when the user has not named a model. Timezone is an IANA name such as America/Denver. Model ids look like opencode-go/kimi-k3.
- Report the saved timezone, default model, and whether Go is connected.

## Create

Call get_settings first. Use its timezone and default model unless the user names different ones. Turn a schedule phrase into a five-field cron expression: weekdays at 8:00 is 0 8 * * 1-5, every day at 21:30 is 30 21 * * *, every hour is 0 * * * *. Ask only when the schedule or workspace folder is missing. Show the name, cron expression, timezone, workspace folder, model, and prompt, then call create_job. Skip the confirmation when the user already gave those fields explicitly.

## List, results, and changes

- List jobs with list_jobs.
- Inspect results with list_runs and get_run. Include status, times, and the assistant summary. Mention the run id so the user can open it in the web UI.
- Pause or resume with set_enabled.
- Change a job with update_job.
- Delete with delete_job only after the user asks to delete.
- Run once with run_now.

Summarize tool results in plain language. Do not invent jobs or run output that the tools did not return.`;

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
