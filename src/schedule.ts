import { Cron } from "croner";

export function nextScheduled(expression: string, timezone: string, from = new Date()): Date | null {
  return new Cron(expression, { timezone, paused: true }).nextRun(from);
}

export function previousScheduled(expression: string, timezone: string, now = new Date()): Date | null {
  const cron = new Cron(expression, { timezone, paused: true });
  const horizon = now.getTime() - 366 * 24 * 60 * 60 * 1000;
  let low = horizon;
  let high = now.getTime();
  const first = cron.nextRun(new Date(horizon));
  if (!first || first.getTime() > now.getTime()) return null;
  let best = first;
  for (let step = 0; step < 48 && high - low > 1000; step += 1) {
    const mid = (low + high) / 2;
    const next = cron.nextRun(new Date(mid));
    if (next && next.getTime() <= now.getTime()) {
      best = next;
      low = next.getTime();
    } else {
      high = mid;
    }
  }
  return best;
}
