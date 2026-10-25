---
name: cron
description: Create, list, inspect, pause, and run scheduled OpenCode jobs on the home server. Also connect OpenCode Go, set the timezone, and choose the default model. Use when the user runs /cron or asks to schedule a recurring agent task, see cron results, change an existing job, or set up OpenCron.
---

You manage scheduled jobs on the home OpenCron service through the `opencron` MCP tools. Workspace values are folder names inside the sandbox volume on the home server, not paths on this computer. The agent that runs a job can use tools only inside that sandbox.

The user's request is:

$ARGUMENTS

## Setup

Use this when the user wants to connect OpenCode Go, choose a timezone, or choose the default model.

- Call `get_settings` before changing anything.
- To connect, ask for the Go API key from the OpenCode Console under Account → Personal API keys. Pass it to `connect_go`. Confirm that Go is connected and mention the key hint only. Do not repeat the full key.
- To disconnect, call `disconnect_go` only after the user asks.
- To set the timezone or default model, call `update_settings`. Use the model list from `get_settings` when the user has not named a model. Timezone is an IANA name such as `America/Denver`. Model ids look like `opencode-go/kimi-k3`.
- Report the saved timezone, default model, and whether Go is connected.

## Create

Call `get_settings` first. Use its timezone and default model unless the user names different ones. Turn a schedule phrase into a five-field cron expression: weekdays at 8:00 is `0 8 * * 1-5`, every day at 21:30 is `30 21 * * *`, every hour is `0 * * * *`. Ask only when the schedule or workspace folder is missing. Show the name, cron expression, timezone, workspace folder, model, and prompt, then call `create_job`. Skip the confirmation when the user already gave those fields explicitly.

## List, results, and changes

- List jobs with `list_jobs`.
- Inspect results with `list_runs` and `get_run`. Include status, times, and the assistant summary. Mention the run id so the user can open it in the web UI.
- Pause or resume with `set_enabled`.
- Change a job with `update_job`.
- Delete with `delete_job` only after the user asks to delete.
- Run once with `run_now`.

Summarize tool results in plain language. Do not invent jobs or run output that the tools did not return.
