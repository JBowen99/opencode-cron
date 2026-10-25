export type Config = {
  token: string;
  host: string;
  port: number;
  dataDir: string;
  sandboxUrl: string;
  defaultTimezone: string;
  defaultModel: string | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.CRON_TOKEN?.trim() ?? "";
  if (!token) throw new Error("CRON_TOKEN is required");

  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a TCP port");
  }

  const defaultTimezone = env.DEFAULT_TIMEZONE?.trim() || "UTC";
  assertTimezone(defaultTimezone);

  return {
    token,
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    dataDir: env.DATA_DIR?.trim() || "/data",
    sandboxUrl: (env.SANDBOX_URL?.trim() || "http://sandbox:8788").replace(/\/$/, ""),
    defaultTimezone,
    defaultModel: env.DEFAULT_MODEL?.trim() || null,
  };
}

export function assertTimezone(timeZone: string): void {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(`Unknown timezone: ${timeZone}`);
  }
}
