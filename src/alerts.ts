import type { DailyBest, RankEvent } from "./types.ts";
import { seriesTitle } from "./lists.ts";

export const TRENDING_LABEL = "trending";

const SIGNATURE = /^(developers|repos):(all|typescript):(.+):(\d+)$/;

export function alertSignature(list: string, language: string, key: string, rank: number): string {
  return `${list}:${language}:${key}:${rank}`;
}

export function signaturesInText(text: string): string[] {
  const found = new Set<string>();
  const block = text.match(/<!--\s*tracked-alerts:([^>]*)-->/);
  if (block) {
    for (const token of block[1].split(/\s+/)) {
      if (SIGNATURE.test(token)) found.add(token);
    }
  }
  for (const match of text.matchAll(/<!--\s*alert:([^\s>]+)\s*-->/g)) {
    if (SIGNATURE.test(match[1])) found.add(match[1]);
  }
  return [...found];
}

export function pendingNotifications(bests: DailyBest[], notified: string[]): RankEvent[] {
  const bestNotified = new Map<string, number>();
  for (const signature of notified) {
    const parsed = SIGNATURE.exec(signature);
    if (!parsed) continue;
    const id = `${parsed[1]}:${parsed[2]}:${parsed[3]}`;
    const rank = Number(parsed[4]);
    const prev = bestNotified.get(id);
    if (prev === undefined || rank < prev) bestNotified.set(id, rank);
  }

  const events: RankEvent[] = [];
  for (const best of bests) {
    if (best.period !== "daily") continue;
    const id = `${best.list}:${best.language}:${best.key}`;
    const previous = bestNotified.get(id) ?? null;
    if (previous !== null && best.bestRank >= previous) continue;
    events.push({
      date: best.date,
      list: best.list,
      language: best.language,
      period: best.period,
      kind: best.kind,
      key: best.key,
      url: best.url,
      rank: best.bestRank,
      previousRank: previous,
      starsToday: best.starsToday,
      featuredRepo: best.featuredRepo,
    });
  }
  events.sort((a, b) => a.list.localeCompare(b.list) || a.language.localeCompare(b.language) || a.rank - b.rank);
  return events;
}

export function renderIssueBody(date: string, bests: DailyBest[], signatures: string[]): string {
  const lines = [
    `Daily GitHub Trending for **${date}** (UTC).`,
    "",
    "This issue opens when a tracked developer or repository appears on a **daily** list, and a comment is added only when that day's best rank improves (including reaching **#1**). Later scrapes that do not improve a rank do not add comments.",
    "",
    "## Best ranks today",
    "",
  ];

  const groups: Array<{ title: string; rows: DailyBest[] }> = [
    { title: "Developers", rows: bests.filter((item) => item.kind === "developer") },
    { title: "Repositories", rows: bests.filter((item) => item.kind === "repo") },
  ];
  for (const group of groups) {
    lines.push(`### ${group.title}`, "");
    if (group.rows.length === 0) {
      lines.push("None yet.", "");
      continue;
    }
    for (const row of group.rows) {
      const extra: string[] = [];
      if (row.featuredRepo) extra.push(`featured repo [${row.featuredRepo}](https://github.com/${row.featuredRepo})`);
      if (row.starsToday !== null) extra.push(`${row.starsToday.toLocaleString("en-US")} stars today`);
      const suffix = extra.length ? ` · ${extra.join(" · ")}` : "";
      lines.push(
        `- **${row.key}** on ${seriesTitle(row.list, row.language, "daily")}: **#${row.bestRank}**${suffix}`,
      );
    }
    lines.push("");
  }

  lines.push(`<!-- tracked-alerts: ${[...new Set(signatures)].sort().join(" ")} -->`);
  return lines.join("\n");
}

export function renderIssueComment(date: string, events: RankEvent[]): string {
  const lines = [`New daily rank${events.length === 1 ? "" : "s"} on ${date}:`, ""];
  for (const event of events) {
    lines.push(eventLine(event));
    lines.push(`<!-- alert:${alertSignature(event.list, event.language, event.key, event.rank)} -->`);
  }
  return lines.join("\n");
}

function eventLine(event: RankEvent): string {
  const where = seriesTitle(event.list, event.language, "daily");
  const who = `**${event.key}**`;
  const detail = [
    event.featuredRepo ? `featured repo \`${event.featuredRepo}\`` : "",
    event.starsToday !== null ? `${event.starsToday.toLocaleString("en-US")} stars today` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const tail = detail ? ` (${detail})` : "";
  if (event.previousRank === null) {
    const top = event.rank === 1 ? " — **#1**" : "";
    return `- ${who} appeared on ${where} at **#${event.rank}**${top}${tail}`;
  }
  if (event.rank === 1) {
    return `- ${who} reached **#1** on ${where} (was #${event.previousRank})${tail}`;
  }
  return `- ${who} on ${where}: **#${event.rank}** (was #${event.previousRank})${tail}`;
}

export interface IssueRecord {
  number: number;
  body: string;
}

export interface IssueStore {
  findByTitle(title: string): Promise<IssueRecord | null>;
  ensureLabel(name: string, color: string, description: string): Promise<void>;
  createIssue(input: { title: string; body: string; labels: string[] }): Promise<IssueRecord>;
  updateIssue(number: number, input: { body: string; labels: string[] }): Promise<void>;
  listComments(number: number): Promise<Array<{ body: string }>>;
  createComment(number: number, body: string): Promise<void>;
}

export function issueTitle(date: string): string {
  return `Trending daily ${date}`;
}

export async function syncDailyIssue(
  store: IssueStore,
  input: { date: string; bests: DailyBest[]; events: RankEvent[] },
): Promise<{ issueNumber: number | null; notified: string[] }> {
  if (input.events.length === 0 && input.bests.length === 0) {
    return { issueNumber: null, notified: [] };
  }

  await store.ensureLabel(
    TRENDING_LABEL,
    "1f6feb",
    "Tracked developer or repository on a daily GitHub Trending list",
  );

  const title = issueTitle(input.date);
  const existing = await store.findByTitle(title);
  const known = new Set<string>(input.events.length ? [] : []);
  if (existing) {
    for (const signature of signaturesInText(existing.body)) known.add(signature);
    for (const comment of await store.listComments(existing.number)) {
      for (const signature of signaturesInText(comment.body)) known.add(signature);
    }
  }

  const fresh = input.events.filter(
    (event) => !known.has(alertSignature(event.list, event.language, event.key, event.rank)),
  );
  const notified = [
    ...known,
    ...fresh.map((event) => alertSignature(event.list, event.language, event.key, event.rank)),
  ];

  if (!existing) {
    if (fresh.length === 0) return { issueNumber: null, notified: [...known] };
    const created = await store.createIssue({
      title,
      body: renderIssueBody(input.date, input.bests, notified),
      labels: [TRENDING_LABEL],
    });
    return { issueNumber: created.number, notified };
  }

  if (fresh.length === 0) return { issueNumber: existing.number, notified: [...known] };

  await store.updateIssue(existing.number, {
    body: renderIssueBody(input.date, input.bests, notified),
    labels: [TRENDING_LABEL],
  });
  await store.createComment(existing.number, renderIssueComment(input.date, fresh));
  return { issueNumber: existing.number, notified };
}

export function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}

export function githubRepository(): string | undefined {
  return process.env.GITHUB_REPOSITORY || undefined;
}
