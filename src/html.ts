import type { JobView, Run } from "./types.js";

export type FormValues = {
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  workspace: string;
  model: string;
  agent: string;
  timeoutSec: string;
  enabled: boolean;
};

export function noticePage(title: string, message: string): string {
  return layout(
    title,
    `<section box-="square" class="stack"><h1>${esc(title.toLowerCase())}</h1><p class="fail">${esc(message)}</p><p><a href="/">jobs</a></p></section>`,
  );
}

export function loginPage(error?: string): string {
  return layout(
    "Sign in",
    `
    <section box-="square" class="stack narrow">
      <h1>opencode cron</h1>
      <p>Enter the service token to open the job list.</p>
      ${error ? `<p class="fail">${esc(error)}</p>` : ""}
      <form method="post" action="/login">
        <label>
          <span>token</span>
          <input type="password" name="token" autocomplete="current-password" required>
        </label>
        <button type="submit">sign in</button>
      </form>
    </section>`,
    false,
  );
}

export function jobsPage(jobs: JobView[]): string {
  const rows = jobs.length
    ? jobs
        .map(
          (job) => `
        <tr>
          <td><a href="/jobs/${esc(job.id)}">${esc(job.name)}</a></td>
          <td><code>${esc(job.schedule)}</code></td>
          <td>${esc(job.workspace)}</td>
          <td>${job.enabled ? esc(formatTime(job.nextRun, job.timezone)) : badge("paused", "foreground2")}</td>
          <td>${job.lastRun ? badge(job.lastRun.status) : `<span class="muted">none</span>`}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="muted">No jobs yet.</td></tr>`;

  return layout(
    "Jobs",
    `
    <div class="actions">
      <h1>jobs</h1>
      <a is-="button" href="/jobs/new">new job</a>
    </div>
    <div class="table-wrap" box-="square">
      <table>
        <thead>
          <tr><th>name</th><th>schedule</th><th>workspace</th><th>next</th><th>last</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`,
  );
}

export function jobFormPage(values: FormValues, error?: string, jobId?: string): string {
  const action = jobId ? `/jobs/${esc(jobId)}` : "/jobs";
  const title = jobId ? "Edit job" : "New job";
  return layout(
    title,
    `
    <p><a href="${jobId ? `/jobs/${esc(jobId)}` : "/"}">${jobId ? "back to job" : "back to jobs"}</a></p>
    <section box-="square" class="stack">
      <h1>${esc(title.toLowerCase())}</h1>
      ${error ? `<p class="fail">${esc(error)}</p>` : ""}
      <form method="post" action="${action}">
        ${fields(values)}
        <button type="submit">${jobId ? "save" : "create"}</button>
      </form>
    </section>`,
  );
}

export function jobPage(job: JobView, runs: Run[], error?: string): string {
  const runRows = runs.length
    ? runs
        .map(
          (run) => `
        <tr>
          <td><a href="/jobs/${esc(job.id)}/runs/${esc(run.id)}">${esc(formatTime(run.createdAt, job.timezone))}</a></td>
          <td>${badge(run.status)}</td>
          <td>${esc(formatTime(run.finishedAt, job.timezone))}</td>
          <td>${esc(preview(run.summary ?? run.error))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No runs yet.</td></tr>`;

  return layout(
    job.name,
    `
    <p><a href="/">jobs</a></p>
    <section box-="square" class="stack">
      <div class="actions">
        <h1>${esc(job.name)}</h1>
        ${job.enabled ? badge("enabled", "ok") : badge("paused", "foreground2")}
      </div>
      ${error ? `<p class="fail">${esc(error)}</p>` : ""}
      <p><code>${esc(job.schedule)}</code> <span class="muted">${esc(job.timezone)}</span></p>
      <p>workspace <code>${esc(job.workspace)}</code></p>
      <p>next ${esc(formatTime(job.nextRun, job.timezone))}${job.model ? ` · model <code>${esc(job.model)}</code>` : ""}${job.agent ? ` · agent <code>${esc(job.agent)}</code>` : ""}</p>
      <p class="muted">timeout ${job.timeoutSec}s</p>
      <h2>prompt</h2>
      <pre>${esc(job.prompt)}</pre>
      <div class="actions">
        <form method="post" action="/jobs/${esc(job.id)}/run"><button type="submit">run now</button></form>
        <form method="post" action="/jobs/${esc(job.id)}/enabled">
          <input type="hidden" name="enabled" value="${job.enabled ? "false" : "true"}">
          <button type="submit" variant-="foreground1">${job.enabled ? "pause" : "resume"}</button>
        </form>
        <a is-="button" href="/jobs/${esc(job.id)}/edit">edit</a>
        <form method="post" action="/jobs/${esc(job.id)}/delete"><button type="submit" variant-="foreground2">delete</button></form>
      </div>
    </section>
    <section box-="square" class="stack">
      <h2>runs</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>started</th><th>status</th><th>finished</th><th>summary</th></tr></thead>
          <tbody>${runRows}</tbody>
        </table>
      </div>
    </section>`,
  );
}

export function runPage(job: JobView, run: Run, log: string): string {
  const pending = run.status === "queued" || run.status === "running";
  return layout(
    "Run",
    `
    <p><a href="/jobs/${esc(job.id)}">${esc(job.name)}</a></p>
    <section box-="square" class="stack">
      <div class="actions"><h1>run</h1>${badge(run.status)}</div>
      <p>started ${esc(formatTime(run.startedAt ?? run.createdAt, job.timezone))}</p>
      <p>finished ${esc(formatTime(run.finishedAt, job.timezone))}</p>
      ${run.error ? `<p class="fail">${esc(run.error)}</p>` : ""}
      <h2>summary</h2>
      <pre>${esc(run.summary || "(no assistant text)")}</pre>
      <h2>log</h2>
      <pre class="log">${esc(log || "(empty)")}</pre>
      ${pending ? `<p class="muted">This page refreshes until the run finishes.</p>` : ""}
    </section>`,
    true,
    pending,
  );
}

export function formValuesFromJob(job: JobView): FormValues {
  return {
    name: job.name,
    prompt: job.prompt,
    schedule: job.schedule,
    timezone: job.timezone,
    workspace: job.workspace,
    model: job.model ?? "",
    agent: job.agent ?? "",
    timeoutSec: String(job.timeoutSec),
    enabled: job.enabled,
  };
}

export function formValuesFromBody(body: Record<string, string>, fallbackTimezone: string): FormValues {
  return {
    name: body.name ?? "",
    prompt: body.prompt ?? "",
    schedule: body.schedule ?? "",
    timezone: body.timezone || fallbackTimezone,
    workspace: body.workspace ?? "",
    model: body.model ?? "",
    agent: body.agent ?? "",
    timeoutSec: body.timeoutSec || "900",
    enabled: body.enabled === "on" || body.enabled === "true" || body.enabled === "1",
  };
}

function fields(values: FormValues): string {
  return `
    <label><span>name</span><input name="name" value="${esc(values.name)}" required></label>
    <label><span>schedule</span><input name="schedule" value="${esc(values.schedule)}" placeholder="0 8 * * 1-5" required></label>
    <p class="muted">Five-field cron. Weekdays at 08:00 is <code>0 8 * * 1-5</code>.</p>
    <label><span>timezone</span><input name="timezone" value="${esc(values.timezone)}" placeholder="America/Denver" required></label>
    <label><span>workspace folder</span><input name="workspace" value="${esc(values.workspace)}" placeholder="notes" required></label>
    <p class="muted">A folder name inside the sandbox volume, not a path on this computer.</p>
    <label><span>model</span><input name="model" value="${esc(values.model)}" placeholder="provider/model"></label>
    <label><span>agent</span><input name="agent" value="${esc(values.agent)}" placeholder="optional"></label>
    <label><span>timeout seconds</span><input name="timeoutSec" type="number" min="30" max="7200" value="${esc(values.timeoutSec)}" required></label>
    <label class="check">
      <input type="hidden" name="enabled" value="false">
      <input is-="checkbox" type="checkbox" name="enabled" value="true" ${values.enabled ? "checked" : ""}>
      enabled
    </label>
    <label><span>prompt</span><textarea name="prompt" required>${esc(values.prompt)}</textarea></label>
  `;
}

function layout(title: string, body: string, authed = true, refresh = false): string {
  const nav = authed
    ? `<header class="bar" box-="square">
        <a class="brand" href="/">opencode cron</a>
        <span class="muted">home server</span>
        <span class="grow"></span>
        <form method="post" action="/logout"><button type="submit" size-="small" variant-="foreground2">log out</button></form>
      </header>`
    : "";
  return `<!doctype html>
<html lang="en" data-webtui-theme="opencode">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#080808">
  <meta name="robots" content="noindex">
  ${refresh ? '<meta http-equiv="refresh" content="2">' : ""}
  <title>${esc(title)} · opencode cron</title>
  <link rel="stylesheet" href="/static/app.css?v=2">
</head>
<body>
  ${nav}
  <main class="stack">${body}</main>
</body>
</html>`;
}

function badge(status: string, variant = statusVariant(status)): string {
  return `<span is-="badge" variant-="${esc(variant)}">${esc(status)}</span>`;
}

function statusVariant(status: string): string {
  if (status === "ok" || status === "enabled") return "ok";
  if (status === "running" || status === "queued") return "running";
  if (status === "failed" || status === "timeout") return "failed";
  return "foreground1";
}

function preview(value: string | null): string {
  if (!value) return "";
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export function formatTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
