import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secretEqual } from "../shared/secrets.js";
import type { Config } from "./config.js";
import { JobError } from "./errors.js";
import {
  formValuesFromBody,
  formValuesFromJob,
  jobFormPage,
  jobPage,
  jobsPage,
  loginPage,
  noticePage,
  runPage,
} from "./html.js";
import { publicJob, publicRun, type Runtime } from "./runtime.js";
import { readFileSync } from "node:fs";
import path from "node:path";

const COOKIE = "cron_session";

export function createApp(config: Config, runtime: Runtime, cssPath = path.join(process.cwd(), "public", "app.css")): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/static/app.css", (c) => {
    const css = readFileSync(cssPath);
    return c.body(css, 200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" });
  });

  app.get("/login", (c) => {
    if (cookieOk(c, config.token)) return c.redirect("/", 303);
    return c.html(loginPage());
  });

  app.post("/login", async (c) => {
    const body = await readForm(c);
    if (!secretEqual(body.token ?? "", config.token)) return c.html(loginPage("Wrong token"), 401);
    setCookie(c, COOKIE, config.token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: c.req.header("x-forwarded-proto") === "https",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return c.redirect("/", 303);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.redirect("/login", 303);
  });

  app.use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    if (pathname === "/health" || pathname.startsWith("/static/") || pathname === "/login") {
      await next();
      return;
    }
    if (pathname === "/mcp" || pathname.startsWith("/api/")) {
      if (!bearerOk(c.req.header("authorization"), config.token)) return c.json({ error: "Unauthorized" }, 401);
      await next();
      return;
    }
    if (!cookieOk(c, config.token)) return c.redirect("/login", 303);
    await next();
  });

  app.get("/", (c) => c.html(jobsPage(runtime.listJobs())));

  app.get("/jobs/new", (c) => c.html(jobFormPage(emptyForm(config.defaultTimezone))));

  app.post("/jobs", async (c) => {
    const body = await readForm(c);
    try {
      const job = runtime.createJob(body);
      return c.redirect(`/jobs/${job.id}`, 303);
    } catch (error) {
      return c.html(jobFormPage(formValuesFromBody(body, config.defaultTimezone), message(error)), status(error));
    }
  });

  app.get("/jobs/:id", (c) => {
    try {
      const job = runtime.getJob(c.req.param("id"));
      return c.html(jobPage(job, runtime.listRuns(job.id)));
    } catch (error) {
      return c.html(noticePage("Not found", message(error)), status(error));
    }
  });

  app.get("/jobs/:id/edit", (c) => {
    try {
      const job = runtime.getJob(c.req.param("id"));
      return c.html(jobFormPage(formValuesFromJob(job), undefined, job.id));
    } catch (error) {
      return c.text(message(error), status(error));
    }
  });

  app.post("/jobs/:id", async (c) => {
    const id = c.req.param("id");
    const body = await readForm(c);
    try {
      runtime.updateJob(id, body);
      return c.redirect(`/jobs/${id}`, 303);
    } catch (error) {
      return c.html(jobFormPage(formValuesFromBody(body, config.defaultTimezone), message(error), id), status(error));
    }
  });

  app.post("/jobs/:id/delete", (c) => {
    const id = c.req.param("id");
    try {
      runtime.deleteJob(id);
      return c.redirect("/", 303);
    } catch (error) {
      try {
        const job = runtime.getJob(id);
        return c.html(jobPage(job, runtime.listRuns(job.id), message(error)), status(error));
      } catch {
        return c.text(message(error), status(error));
      }
    }
  });

  app.post("/jobs/:id/run", (c) => {
    const id = c.req.param("id");
    try {
      const run = runtime.requestRun(id);
      return c.redirect(`/jobs/${id}/runs/${run.id}`, 303);
    } catch (error) {
      return c.text(message(error), status(error));
    }
  });

  app.post("/jobs/:id/enabled", async (c) => {
    const id = c.req.param("id");
    const body = await readForm(c);
    try {
      runtime.setEnabled(id, body.enabled === "true" || body.enabled === "on" || body.enabled === "1");
      return c.redirect(`/jobs/${id}`, 303);
    } catch (error) {
      return c.text(message(error), status(error));
    }
  });

  app.get("/jobs/:id/runs/:runId", (c) => {
    try {
      const loaded = runtime.getRun(c.req.param("runId"));
      if (loaded.job.id !== c.req.param("id")) return c.text("Run not found", 404);
      return c.html(runPage(runtime.getJob(loaded.job.id), loaded.run, loaded.log));
    } catch (error) {
      return c.text(message(error), status(error));
    }
  });

  app.get("/api/jobs", (c) => c.json(runtime.listJobs().map(publicJob)));

  app.post("/api/jobs", async (c) => {
    try {
      return c.json(publicJob(runtime.createJob(await readJson(c))), 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  app.get("/api/jobs/:id", (c) => {
    try {
      return c.json(publicJob(runtime.getJob(c.req.param("id"))));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.patch("/api/jobs/:id", async (c) => {
    try {
      return c.json(publicJob(runtime.updateJob(c.req.param("id"), await readJson(c))));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.delete("/api/jobs/:id", (c) => {
    try {
      runtime.deleteJob(c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/jobs/:id/run", (c) => {
    try {
      return c.json(publicRun(runtime.requestRun(c.req.param("id"))), 202);
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/api/jobs/:id/enabled", async (c) => {
    try {
      const body = await readJson(c);
      if (typeof body.enabled !== "boolean") return c.json({ error: "enabled must be true or false" }, 400);
      return c.json(publicJob(runtime.setEnabled(c.req.param("id"), body.enabled)));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.get("/api/jobs/:id/runs", (c) => {
    try {
      const limit = Number(c.req.query("limit") ?? 50);
      return c.json(runtime.listRuns(c.req.param("id"), limit).map(publicRun));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.get("/api/runs/:id", (c) => {
    try {
      const loaded = runtime.getRun(c.req.param("id"));
      return c.json({ ...publicRun(loaded.run), log: loaded.log });
    } catch (error) {
      return fail(c, error);
    }
  });

  return app;
}

function cookieOk(c: Context, token: string): boolean {
  return secretEqual(getCookie(c, COOKIE) ?? "", token);
}

function bearerOk(header: string | undefined, token: string): boolean {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return secretEqual(match?.[1]?.trim() ?? "", token);
}

async function readForm(c: Context): Promise<Record<string, string>> {
  const body = await c.req.parseBody();
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    const text = formValue(value);
    if (text !== undefined) values[key] = text;
  }
  return values;
}

function formValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const last = value.at(-1);
    return typeof last === "string" ? last : undefined;
  }
  return undefined;
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new JobError("Expected a JSON object", 400);
  return body as Record<string, unknown>;
}

function fail(c: Context, error: unknown): Response {
  if (error instanceof JobError) return c.json({ error: error.message }, status(error));
  if (error instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
  console.error(error);
  return c.json({ error: "Internal error" }, 500);
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

function status(error: unknown): 400 | 401 | 404 | 409 | 500 {
  if (error instanceof JobError && (error.status === 400 || error.status === 401 || error.status === 404 || error.status === 409)) {
    return error.status;
  }
  return 500;
}

function emptyForm(timezone: string) {
  return { ...formValuesFromBody({}, timezone), enabled: true };
}
