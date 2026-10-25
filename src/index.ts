import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./http.js";
import { mountMcp } from "./mcp.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig();
const runtime = createRuntime(config);
const app = createApp(config, runtime);
mountMcp(app, runtime);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`OpenCron listening on ${info.address}:${info.port}`);
  runtime.start();
});

function shutdown() {
  runtime.stop();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
