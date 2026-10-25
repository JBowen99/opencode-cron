export type TranscriptItem =
  | { kind: "chat"; text: string }
  | { kind: "tool"; name: string; status: string; call: string; output: string }
  | { kind: "note"; text: string }
  | { kind: "stderr"; text: string }
  | { kind: "meta"; text: string };

const CALL_CAP = 1_500;
const OUTPUT_CAP = 2_000;

export function transcriptFromLog(log: string): TranscriptItem[] {
  const { stdout, stderr } = splitRunLog(log);
  const items: TranscriptItem[] = [];
  const plain: string[] = [];
  let steps = 0;
  let cost = 0;

  const flushPlain = () => {
    const text = plain.join("\n").trim();
    plain.length = 0;
    if (text) items.push({ kind: "note", text });
  };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      if (line.trim()) plain.push(line);
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      plain.push(line);
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    flushPlain();
    if (record.type === "text") {
      const text = partText(record.part);
      if (text) items.push({ kind: "chat", text });
      continue;
    }
    if (record.type === "error") {
      items.push({ kind: "stderr", text: errorText(record.error) });
      continue;
    }
    if (record.type === "tool_use") {
      const tool = toolItem(record.part);
      if (tool) items.push(tool);
      continue;
    }
    if (record.type === "step_finish") {
      steps += 1;
      cost += stepCost(record.part);
    }
  }
  flushPlain();
  if (stderr.trim()) items.push({ kind: "stderr", text: stderr.trim() });
  if (steps > 0) items.push({ kind: "meta", text: metaLine(steps, cost) });
  return items;
}

function splitRunLog(log: string): { stdout: string; stderr: string } {
  let body = log;
  if (body.startsWith("# stdout\n")) body = body.slice("# stdout\n".length);
  else if (body.startsWith("# stdout\r\n")) body = body.slice("# stdout\r\n".length);
  const marker = body.includes("\n# stderr\n") ? "\n# stderr\n" : body.includes("\r\n# stderr\r\n") ? "\r\n# stderr\r\n" : "";
  if (!marker) return { stdout: body, stderr: "" };
  const index = body.indexOf(marker);
  return { stdout: body.slice(0, index), stderr: body.slice(index + marker.length) };
}

function toolItem(part: unknown): TranscriptItem | null {
  if (!part || typeof part !== "object") return null;
  const record = part as Record<string, unknown>;
  const name = typeof record.tool === "string" && record.tool.trim() ? record.tool.trim() : "tool";
  const state = record.state;
  if (!state || typeof state !== "object") return { kind: "tool", name, status: "", call: "", output: "" };
  const fields = state as Record<string, unknown>;
  const status = typeof fields.status === "string" ? fields.status : "";
  const input = fields.input && typeof fields.input === "object" ? (fields.input as Record<string, unknown>) : {};
  const output = status === "error" ? textOf(fields.error) : textOf(fields.output);
  return {
    kind: "tool",
    name,
    status,
    call: clip(callText(name, input), CALL_CAP),
    output: clip(output, OUTPUT_CAP),
  };
}

function callText(tool: string, input: Record<string, unknown>): string {
  if (tool === "shell" || tool === "bash") {
    const command = textOf(input.command);
    return command ? `$ ${command}` : "";
  }
  if (tool === "execute") return textOf(input.code);
  if (tool === "read" || tool === "write") return textOf(input.path);
  if (tool === "edit") {
    const path = textOf(input.path);
    const removed = textOf(input.oldString);
    const added = textOf(input.newString);
    if (!removed && !added) return path;
    return [path, removed ? `- ${removed}` : "", added ? `+ ${added}` : ""].filter(Boolean).join("\n");
  }
  const lines = Object.entries(input)
    .map(([key, value]) => `${key}: ${textOf(value) || JSON.stringify(value)}`)
    .filter((line) => !line.endsWith(": "));
  return lines.join("\n");
}

function partText(part: unknown): string {
  if (!part || typeof part !== "object" || !("text" in part)) return "";
  const text = (part as { text: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}

function stepCost(part: unknown): number {
  if (!part || typeof part !== "object" || !("cost" in part)) return 0;
  const cost = (part as { cost: unknown }).cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}

function errorText(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (!error || typeof error !== "object") return "Unknown OpenCode error";
  const record = error as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === "object" && "message" in data && typeof (data as { message: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  if (typeof record.message === "string") return record.message;
  if (typeof record.name === "string") return record.name;
  return "Unknown OpenCode error";
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).replace(/\s+$/, "")}\n… truncated, full text is in the raw log`;
}

function metaLine(steps: number, cost: number): string {
  const label = steps === 1 ? "1 step" : `${steps} steps`;
  if (cost <= 0) return label;
  const money = cost < 0.0001 ? cost.toExponential(1) : cost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${label} · $${money}`;
}
