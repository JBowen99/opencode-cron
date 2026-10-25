import { transcriptFromLog, type TranscriptItem } from "../shared/transcript.js";
import type { JobView, Run, ServerSettings } from "./types.js";

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
    <section box-="square" class="stack">
      <h1><span class="prompt">&gt;</span> OpenCron</h1>
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
          <td class="wrap"><a href="/jobs/${esc(job.id)}">${esc(job.name)}</a></td>
          <td><code>${esc(job.schedule)}</code></td>
          <td class="wrap">${esc(job.workspace)}</td>
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
          <tr><th class="wrap">name</th><th>schedule</th><th class="wrap">workspace</th><th>next</th><th>last</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`,
  );
}

export function jobFormPage(values: FormValues, error?: string, jobId?: string, defaultModel: string | null = null): string {
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
        ${fields(values, defaultModel)}
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
          <td class="summary">${esc(preview(run.summary ?? run.error))}</td>
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
          <thead><tr><th>started</th><th>status</th><th>finished</th><th class="summary">summary</th></tr></thead>
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
      <h2>output</h2>
      ${renderTranscript(log)}
      <details class="raw">
        <summary>raw</summary>
        <pre class="log">${esc(log || "(empty)")}</pre>
      </details>
      ${pending ? `<p class="muted">This page refreshes until the run finishes.</p>` : ""}
    </section>`,
    true,
    pending,
  );
}

function renderTranscript(log: string): string {
  const items = log.trim() ? transcriptFromLog(log) : [];
  if (!items.length) return `<p class="muted">(empty)</p>`;
  return `<div class="transcript">${items.map(renderItem).join("")}</div>`;
}

function renderItem(item: TranscriptItem): string {
  if (item.kind === "chat") return `<pre class="chat">${esc(item.text)}</pre>`;
  if (item.kind === "note") return `<pre class="note">${esc(item.text)}</pre>`;
  if (item.kind === "stderr") return `<pre class="note fail">${esc(item.text)}</pre>`;
  if (item.kind === "meta") return `<p class="muted">${esc(item.text)}</p>`;
  const failed = item.status === "error";
  const status = item.status && item.status !== "completed" ? ` <span class="${failed ? "fail" : "muted"}">${esc(item.status)}</span>` : "";
  const call = item.call ? `<pre class="call">${esc(item.call)}</pre>` : "";
  const output = item.output ? `<pre class="out">${esc(item.output)}</pre>` : "";
  return `<div class="turn"><p class="tool-head"><span class="prompt">→</span> ${esc(item.name)}${status}</p>${call}${output}</div>`;
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

function fields(values: FormValues, defaultModel: string | null = null): string {
  return `
    <label><span>name</span><input name="name" value="${esc(values.name)}" required></label>
    <label><span>schedule</span><input name="schedule" value="${esc(values.schedule)}" placeholder="0 8 * * 1-5" required></label>
    <p class="muted">Five-field cron. Weekdays at 08:00 is <code>0 8 * * 1-5</code>.</p>
    <label><span>timezone</span>${timezoneSelect(values.timezone)}</label>
    <label><span>workspace folder</span><input name="workspace" value="${esc(values.workspace)}" placeholder="notes" required></label>
    <p class="muted">A folder name inside the sandbox volume, not a path on this computer.</p>
    <label><span>model</span><input name="model" value="${esc(values.model)}" placeholder="provider/model"></label>
    ${values.model || !defaultModel ? "" : `<p class="muted">Blank uses ${esc(defaultModel)}.</p>`}
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

export function settingsPage(settings: ServerSettings, error?: string): string {
  const go = settings.goConnected
    ? settings.goSource === "saved"
      ? `Connected with a key saved on this server${settings.goKeyHint ? `, ending in ${esc(settings.goKeyHint)}` : ""}.`
      : "Connected with the key from the server environment. Paste a key to replace it."
      : "";
  const modelChoices = settings.models.includes(settings.defaultModel ?? "")
    ? settings.models
    : settings.defaultModel
      ? [settings.defaultModel, ...settings.models]
      : settings.models;
  const modelField = modelChoices.length
    ? `<select name="defaultModel">
        <option value="" ${settings.defaultModel ? "" : "selected"}>none</option>
        ${modelChoices
          .map(
            (model) =>
              `<option value="${esc(model)}" ${model === settings.defaultModel ? "selected" : ""}>${esc(model)}</option>`,
          )
          .join("")}
      </select>`
    : `<input name="defaultModel" value="${esc(settings.defaultModel ?? "")}" placeholder="opencode-go/kimi-k3">`;
  return layout(
    "Settings",
    `
    <section box-="square" class="stack">
      <h1>settings</h1>
      ${error ? `<p class="fail">${esc(error)}</p>` : ""}
      <h2>OpenCode Go</h2>
      <p>${settings.goConnected ? badge("connected", "ok") : badge("not connected", "failed")} ${go}</p>
      <p class="muted">Paste a key from the OpenCode Console: Account, then Personal API keys. The key stays on this server and is not shown again.</p>
      <form method="post" action="/settings/go">
        <label><span>API key</span><input type="password" name="apiKey" autocomplete="off"></label>
        <button type="submit">connect</button>
      </form>
      ${
        settings.goSource === "saved"
          ? `<form method="post" action="/settings/go/disconnect"><button type="submit" variant-="foreground2">disconnect</button></form>`
          : ""
      }
      ${settings.modelsError ? `<p class="fail">${esc(settings.modelsError)}</p>` : ""}
      <h2>defaults</h2>
      <form method="post" action="/settings">
        <label><span>timezone</span>${timezoneSelect(settings.timezone)}</label>
        <label><span>default model</span>${modelField}</label>
        <p class="muted">New jobs use this timezone and model unless you choose others.</p>
        <button type="submit">save</button>
      </form>
    </section>`,
  );
}

function timezoneSelect(selected: string): string {
  const zones = Intl.supportedValuesOf("timeZone");
  const options = zones.includes(selected) ? zones : [selected, ...zones];
  return `<select name="timezone" required>${options
    .map((zone) => `<option value="${esc(zone)}" ${zone === selected ? "selected" : ""}>${esc(zone)}</option>`)
    .join("")}</select>`;
}

function layout(title: string, body: string, authed = true, refresh = false): string {
  const nav = authed
    ? `<header class="bar">
        <a class="brand" href="/"><span class="prompt">&gt;</span> OpenCron</a>
        <a href="/">jobs</a>
        <a href="/settings">settings</a>
        <form method="post" action="/logout"><button type="submit" size-="small" variant-="foreground2">log out</button></form>
      </header>`
    : "";
  return `<!doctype html>
<html lang="en" data-webtui-theme="opencode">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a0a0a">
  <meta name="robots" content="noindex">
  ${refresh ? '<meta http-equiv="refresh" content="2">' : ""}
  <title>${esc(title)} · OpenCron</title>
  <link rel="stylesheet" href="/static/app.css?v=8">
</head>
<body>
  <div class="frame">
    ${nav}
    <main class="stack">${body}</main>
  </div>
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
