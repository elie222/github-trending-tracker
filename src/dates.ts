export function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(end) || cursor > end) return out;
  for (; cursor <= end; cursor += 86_400_000) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return out;
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
