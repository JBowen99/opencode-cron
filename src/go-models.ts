import { JobError } from "./errors.js";

const GO_MODELS_URL = "https://opencode.ai/inference/go/v1/models";

export function modelIdsFromCatalog(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || trimmed.includes("\n") || trimmed.length > 200) continue;
    ids.add(trimmed.includes("/") ? trimmed : `opencode-go/${trimmed}`);
  }
  return [...ids].sort();
}

export function preferGoModels(models: string[]): string[] {
  const go = models.filter((model) => model.startsWith("opencode-go/"));
  return go.length ? go : models;
}

export async function listGoModels(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchImpl(GO_MODELS_URL, {
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new JobError("Could not reach OpenCode Go", 502);
  }
  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new JobError("OpenCode Go rejected that API key", 401);
  }
  if (!response.ok) throw new JobError(`OpenCode Go model list failed (${response.status})`, 502);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new JobError("OpenCode Go returned an unreadable model list", 502);
  }
  const models = modelIdsFromCatalog(parsed);
  if (!models.length) throw new JobError("OpenCode Go returned no models for that key", 502);
  return models;
}
