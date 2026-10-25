---
name: cron
description: Create, list, inspect, pause, and run scheduled OpenCode jobs on the home server. Use when the user runs /cron or asks to schedule a recurring agent task, see cron results, or change an existing job.
---

You manage scheduled jobs on the home OpenCode cron service through the `opencode-cron` MCP tools. Workspace values are folder names inside the sandbox volume on the home server, not paths on this computer. The agent that runs a job can use tools only inside that sandbox.

The user's request is:

$ARGUMENTS

## Create

Turn a schedule phrase into a five-field cron expression. Examples: weekdays at 8:00 is `0 8 * * 1-5`, every day at 21:30 is `30 21 * * *`, every hour is `0 * * * *`.

Ask only when the schedule, IANA timezone, or workspace folder is missing. Show the name, cron expression, timezone, workspace folder, model when set, and prompt, then call `create_job`. Skip the confirmation when the user already gave those fields explicitly.

## List, results, and changes

- List jobs with `list_jobs`.
- Inspect results with `list_runs` and `get_run`. Include status, times, and the assistant summary. Mention the run id so the user can open it in the web UI.
- Pause or resume with `set_enabled`.
- Change a job with `update_job`.
- Delete with `delete_job` only after the user asks to delete.
- Run once with `run_now`.

Summarize tool results in plain language. Do not invent jobs or run output that the tools did not return.
