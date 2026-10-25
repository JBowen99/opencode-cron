# OpenCode cron

A small home-server scheduler. Jobs run as unattended OpenCode agents inside a sandbox container, using an OpenCode Go API key. A web UI and an MCP endpoint on the app container let you create jobs, list them, and read results.

Coolify deploys [`compose.yaml`](compose.yaml). Removing that resource and its volumes deletes the database, logs, workspace files, and both containers.

## Deploy

Create a Docker Compose application in Coolify pointed at this repository. Assign the public domain to the `app` service on port `8787` only. Leave `sandbox` unpublished. Reach the domain over Tailscale, and do not port-forward it to the public internet.

Set these environment variables in Coolify:

| Variable | Service | Purpose |
| --- | --- | --- |
| `CRON_TOKEN` | app | Bearer token for the web UI, API, and MCP |
| `OPENCODE_API_KEY` | sandbox | OpenCode Go key. It never leaves this container |
| `DEFAULT_TIMEZONE` | app | IANA timezone used when a job does not set one |
| `DEFAULT_MODEL` | both | `provider/model` passed to `opencode run` when a job omits a model |

To see model ids available to the key:

```bash
docker compose exec sandbox opencode models
```

Open the Coolify domain, sign in with `CRON_TOKEN`, and create a job. The workspace value is a folder name inside the sandbox volume, such as `notes`.

`docker compose down -v` removes both containers and the `cron-data` and `cron-workspaces` volumes.

## /cron on another computer

Copy [`skill/cron`](skill/cron) to `~/.config/opencode/skills/cron/` so OpenCode exposes `/cron`. Merge [`skill/opencode.mcp.jsonc`](skill/opencode.mcp.jsonc) into the global OpenCode config, replace the domain, and export `OPENCODE_CRON_TOKEN` with the same value as `CRON_TOKEN`.

`/cron weekdays at 8am, timezone America/Denver, workspace notes: summarize unread mail` asks the local agent to create a job through the MCP tools. `/cron list` and `/cron results for notes` read the same records as the web UI.
