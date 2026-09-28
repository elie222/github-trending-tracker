import fs from "node:fs";
import path from "node:path";
import { matchesDeveloper, matchesRepo } from "./config.ts";
import { eachDate } from "./dates.ts";
import { PROMINENT_DAILY, seriesKey, seriesTitle } from "./lists.ts";
import { isDeveloperEntry } from "./snapshot.ts";
import type {
  BackfillManifest,
  Language,
  ListKind,
  Period,
  Snapshot,
  TrackingConfig,
  TrendingEntry,
} from "./types.ts";

export interface DayRank {
  date: string;
  rank: number;
  url: string;
  starsToday: number | null;
  featuredRepo: string | null;
  source: string;
  latestRank: number;
  latestFeaturedRepo: string | null;
}

export interface StreakStats {
  current: number;
  currentStart: string | null;
  currentEnd: string | null;
  longest: number;
  longestStart: string | null;
  longestEnd: string | null;
}

export interface SeriesStats {
  list: ListKind;
  language: Language;
  period: Period;
  key: string;
  kind: "developer" | "repo";
  days: DayRank[];
  daysListed: number;
  daysNumberOne: number;
  daysTop10: number;
  bestEver: number | null;
  streak: StreakStats;
  asOf: string | null;
}

export interface Report {
  today: string;
  config: TrackingConfig;
  manifest: BackfillManifest | null;
  developerSeries: SeriesStats[];
  repoSeries: SeriesStats[];
  repoNames: string[];
  secondary: SeriesStats[];
}

const DAILY_SPECS: Array<{ list: ListKind; language: Language }> = [
  { list: "developers", language: "typescript" },
  { list: "developers", language: "all" },
  { list: "repos", language: "typescript" },
  { list: "repos", language: "all" },
];

export function streakStats(listed: Set<string>, unobserved: Set<string>, from: string, to: string): StreakStats {
  const dates = eachDate(from, to);
  let longest = 0;
  let longestStart: string | null = null;
  let longestEnd: string | null = null;
  let run = 0;
  let runStart: string | null = null;

  for (const date of dates) {
    if (unobserved.has(date)) continue;
    if (listed.has(date)) {
      if (run === 0) runStart = date;
      run += 1;
      if (run > longest) {
        longest = run;
        longestStart = runStart;
        longestEnd = date;
      }
    } else {
      run = 0;
      runStart = null;
    }
  }

  let current = 0;
  let currentStart: string | null = null;
  let currentEnd: string | null = null;
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const date = dates[index];
    if (unobserved.has(date)) continue;
    if (!listed.has(date)) break;
    current += 1;
    currentEnd ??= date;
    currentStart = date;
  }

  return { current, currentStart, currentEnd, longest, longestStart, longestEnd };
}

export function buildReport(input: {
  snapshots: Snapshot[];
  manifest: BackfillManifest | null;
  config: TrackingConfig;
  today: string;
}): Report {
  const developerSeries: SeriesStats[] = [];
  for (const username of input.config.developers) {
    for (const spec of DAILY_SPECS.filter((item) => item.list === "developers")) {
      developerSeries.push(
        statsFor(
          input,
          spec.list,
          spec.language,
          "daily",
          username,
          "developer",
          (entry) => isDeveloperEntry(entry) && entry.username.toLowerCase() === username.toLowerCase(),
        ),
      );
    }
  }

  const repoKeys = new Set<string>();
  for (const name of input.config.repoNames) {
    for (const owner of input.config.repoOwners) repoKeys.add(`${owner}/${name}`);
  }
  for (const snapshot of input.snapshots) {
    if (snapshot.list !== "repos") continue;
    for (const scrape of snapshot.scrapes) {
      for (const entry of scrape.entries) {
        if (!isDeveloperEntry(entry) && matchesRepo(entry.name, input.config)) repoKeys.add(entry.name);
      }
    }
  }

  const repoNames = [...repoKeys].sort((a, b) => {
    const aNamed = input.config.repoNames.some((name) => a.toLowerCase().endsWith(`/${name.toLowerCase()}`));
    const bNamed = input.config.repoNames.some((name) => b.toLowerCase().endsWith(`/${name.toLowerCase()}`));
    if (aNamed !== bNamed) return aNamed ? -1 : 1;
    const aIndex = input.config.repoNames.findIndex((name) => a.toLowerCase().endsWith(`/${name.toLowerCase()}`));
    const bIndex = input.config.repoNames.findIndex((name) => b.toLowerCase().endsWith(`/${name.toLowerCase()}`));
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.localeCompare(b);
  });

  const repoSeries: SeriesStats[] = [];
  for (const repo of repoNames) {
    for (const spec of DAILY_SPECS.filter((item) => item.list === "repos")) {
      repoSeries.push(
        statsFor(
          input,
          spec.list,
          spec.language,
          "daily",
          repo,
          "repo",
          (entry) => !isDeveloperEntry(entry) && entry.name.toLowerCase() === repo.toLowerCase(),
        ),
      );
    }
  }

  const secondary: SeriesStats[] = [];
  for (const period of ["weekly", "monthly"] as const) {
    for (const username of input.config.developers) {
      for (const language of ["typescript", "all"] as const) {
        secondary.push(
          statsFor(
            input,
            "developers",
            language,
            period,
            username,
            "developer",
            (entry) => isDeveloperEntry(entry) && matchesDeveloper(entry.username, input.config) && entry.username.toLowerCase() === username.toLowerCase(),
          ),
        );
      }
    }
    for (const repo of repoNames) {
      for (const language of ["typescript", "all"] as const) {
        secondary.push(
          statsFor(
            input,
            "repos",
            language,
            period,
            repo,
            "repo",
            (entry) => !isDeveloperEntry(entry) && entry.name.toLowerCase() === repo.toLowerCase(),
          ),
        );
      }
    }
  }

  return {
    today: input.today,
    config: input.config,
    manifest: input.manifest,
    developerSeries,
    repoSeries,
    repoNames,
    secondary,
  };
}

function statsFor(
  input: { snapshots: Snapshot[]; manifest: BackfillManifest | null },
  list: ListKind,
  language: Language,
  period: Period,
  key: string,
  kind: "developer" | "repo",
  match: (entry: TrendingEntry) => boolean,
): SeriesStats {
  const snapshots = input.snapshots.filter(
    (snapshot) => snapshot.list === list && snapshot.language === language && snapshot.period === period,
  );
  const days: DayRank[] = [];
  for (const snapshot of snapshots) {
    const day = bestDay(snapshot, match);
    if (day) days.push(day);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const window = observationWindow(input.manifest, list, language, period, snapshots.map((item) => item.date));
  const listed = new Set(days.map((day) => day.date));
  const streak =
    window === null
      ? emptyStreak()
      : streakStats(listed, window.unobserved, window.from, window.to);

  return {
    list,
    language,
    period,
    key,
    kind,
    days,
    daysListed: days.length,
    daysNumberOne: days.filter((day) => day.rank === 1).length,
    daysTop10: days.filter((day) => day.rank <= 10).length,
    bestEver: days.length ? Math.min(...days.map((day) => day.rank)) : null,
    streak,
    asOf: window?.to ?? null,
  };
}

function bestDay(snapshot: Snapshot, match: (entry: TrendingEntry) => boolean): DayRank | null {
  let bestRank = Infinity;
  let url = "";
  let starsToday: number | null = null;
  let featuredRepo: string | null = null;
  const sources = new Set<string>();
  let latestAt = "";
  let latestRank = 0;
  let latestFeaturedRepo: string | null = null;

  for (const scrape of snapshot.scrapes) {
    for (const entry of scrape.entries) {
      if (!match(entry)) continue;
      if (latestAt === "" || scrape.scrapedAt >= latestAt) {
        latestAt = scrape.scrapedAt;
        latestRank = entry.rank;
        latestFeaturedRepo = isDeveloperEntry(entry) ? (entry.featuredRepo?.name ?? null) : null;
      }
      if (entry.rank < bestRank) {
        bestRank = entry.rank;
        url = entry.url;
        starsToday = isDeveloperEntry(entry) ? null : entry.starsToday;
        featuredRepo = isDeveloperEntry(entry) ? (entry.featuredRepo?.name ?? null) : null;
        sources.clear();
        sources.add(scrape.source);
        continue;
      }
      if (entry.rank === bestRank) {
        sources.add(scrape.source);
        if (!isDeveloperEntry(entry) && starsToday === null) starsToday = entry.starsToday;
        if (isDeveloperEntry(entry) && featuredRepo === null) featuredRepo = entry.featuredRepo?.name ?? null;
      }
    }
  }

  if (!Number.isFinite(bestRank)) return null;
  const source = [...sources].sort().join("+");
  return {
    date: snapshot.date,
    rank: bestRank,
    url,
    starsToday,
    featuredRepo,
    source,
    latestRank,
    latestFeaturedRepo,
  };
}

function observationWindow(
  manifest: BackfillManifest | null,
  list: ListKind,
  language: Language,
  period: Period,
  snapshotDates: string[],
): { from: string; to: string; unobserved: Set<string> } | null {
  const meta = period === "daily" ? manifest?.lists[seriesKey(list, language, period)] : undefined;
  const dates = [...snapshotDates];
  if (!meta && dates.length === 0) return null;

  let from = meta?.since ?? dates.slice().sort()[0];
  let to = meta?.through ?? dates.slice().sort().at(-1)!;
  for (const date of dates) {
    if (date < from) from = date;
    if (date > to) to = date;
  }
  const unobserved = new Set(meta?.unobserved ?? []);
  const snapshotSet = new Set(dates);
  for (const date of snapshotSet) unobserved.delete(date);
  if (meta) {
    for (const date of eachDate(meta.through, to)) {
      if (date > meta.through && !snapshotSet.has(date)) unobserved.add(date);
    }
  }
  return { from, to, unobserved };
}

function emptyStreak(): StreakStats {
  return {
    current: 0,
    currentStart: null,
    currentEnd: null,
    longest: 0,
    longestStart: null,
    longestEnd: null,
  };
}

export function renderHistory(report: Report): string {
  const lines: string[] = [];
  lines.push("# Trending history", "");
  lines.push(intro(report), "");
  lines.push("## Today", "");
  lines.push(...todaySection(report), "");
  lines.push("## Totals", "");
  lines.push(...totalsTable([...report.developerSeries, ...report.repoSeries]), "");

  for (const username of report.config.developers) {
    const series = report.developerSeries.filter((item) => item.key.toLowerCase() === username.toLowerCase());
    lines.push(`## ${username} — developers`, "");
    lines.push(
      "TypeScript daily and all-languages daily are the lists that matter. Rank is the best (lowest) place reached that UTC day.",
      "",
    );
    for (const item of series) {
      lines.push(...seriesSection(item), "");
    }
  }

  lines.push("## Repository appearances", "");
  lines.push(
    "Any repository owned by a tracked owner is included, plus the named repositories `inbox-zero` and `rakazo` under any owner.",
    "",
  );
  if (report.repoNames.length === 0) {
    lines.push("No repository appearances yet.", "");
  }
  for (const repo of report.repoNames) {
    const series = report.repoSeries.filter((item) => item.key === repo);
    lines.push(`### ${repo}`, "");
    if (series.every((item) => item.daysListed === 0)) {
      lines.push("No daily appearances in the backfill or in live snapshots.", "");
      continue;
    }
    for (const item of series) {
      if (item.daysListed === 0) {
        lines.push(`**${seriesTitle(item.list, item.language, item.period)}:** no appearances.`, "");
        continue;
      }
      lines.push(...seriesSection(item), "");
    }
  }

  const secondaryHits = report.secondary.filter((item) => item.daysListed > 0);
  lines.push("## Weekly and monthly snapshots", "");
  lines.push(
    "These periods are scraped and stored, but they are not part of the daily totals or streaks. The archive used for backfill has daily lists only, so this section fills in as live scrapes accumulate.",
    "",
  );
  if (secondaryHits.length === 0) {
    lines.push("No weekly or monthly appearances recorded yet.", "");
  } else {
    lines.push("| List | Name | Date | Best rank |", "| --- | --- | --- | --- |");
    for (const item of secondaryHits) {
      const latest = item.days[item.days.length - 1];
      lines.push(
        `| ${md(seriesTitle(item.list, item.language, item.period))} | ${md(item.key)} | ${latest.date} | #${latest.rank} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function intro(report: Report): string {
  const devs = report.config.developers.map((name) => `\`${name}\``).join(", ");
  const owners = report.config.repoOwners.map((name) => `\`${name}/*\``).join(", ");
  const allReposStart = earliestAvailable(report, "repos-all-daily");
  const allRepoNote =
    allReposStart && allReposStart !== report.config.backfill.repositoriesSince
      ? ` All-languages repository files in that archive start on ${allReposStart}.`
      : "";
  return [
    `Daily GitHub Trending record for ${devs}. Repositories are every repo under ${owners}, and any repository named ${joinAnd(report.config.repoNames.map((name) => `\`${name}\``))}.`,
    "",
    "Each UTC day keeps every scrape. History uses the **best rank** that day. Days with no archive file, or an empty archived list, are unknown and do not break streaks. A streak counts listed days only, so a date range can be longer than the day count when unknown days sit in the middle.",
    "",
    `Backfill source: [${report.config.backfill.archiveRepo}](https://github.com/${report.config.backfill.archiveRepo}). Developers since ${report.config.backfill.developersSince}. Repositories since ${report.config.backfill.repositoriesSince}. Languages: TypeScript and all languages. Backfilled rows are marked \`backfill\` (the timestamp is the archive's UTC date, not a clock time; star counts and featured repos are blank). Rows marked \`live\` were scraped by this repo.${allRepoNote}`,
  ].join("\n");
}

function earliestAvailable(report: Report, key: string): string | null {
  const meta = report.manifest?.lists[key];
  if (!meta) return null;
  const missing = new Set(meta.unobserved);
  for (const date of eachDate(meta.since, meta.through)) {
    if (!missing.has(date)) return date;
  }
  return meta.since;
}

function todaySection(report: Report): string[] {
  const lines = [`UTC day **${report.today}**.`, ""];
  lines.push("| List | Result |", "| --- | --- |");
  for (const spec of PROMINENT_DAILY) {
    const pool = spec.list === "developers" ? report.developerSeries : report.repoSeries;
    const rows = pool.filter(
      (item) => item.language === spec.language && item.period === "daily" && item.days.some((day) => day.date === report.today),
    );
    const label = seriesTitle(spec.list, spec.language, "daily");
    if (rows.length === 0) {
      lines.push(`| ${label} | not listed |`);
      continue;
    }
    const text = rows
      .map((row) => {
        const day = row.days.find((item) => item.date === report.today)!;
        const extra: string[] = [];
        if (day.latestRank !== day.rank) extra.push(`latest scrape #${day.latestRank}`);
        const featured = day.featuredRepo ?? day.latestFeaturedRepo;
        if (featured) extra.push(featured);
        const suffix = extra.length ? ` · ${extra.join(" · ")}` : "";
        return `**#${day.rank}** ${row.key}${suffix}`;
      })
      .join("<br>");
    lines.push(`| ${label} | ${text} |`);
  }
  return lines;
}

function totalsTable(series: SeriesStats[]): string[] {
  const lines = [
    "| Name | List | Days listed | Days #1 | Days top 10 | Best | Current streak | Longest streak |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];
  for (const item of series) {
    lines.push(
      `| ${md(item.key)} | ${md(seriesTitle(item.list, item.language, item.period))} | ${item.daysListed} | ${item.daysNumberOne} | ${item.daysTop10} | ${item.bestEver === null ? "—" : `#${item.bestEver}`} | ${formatStreak(item.streak, "current")} | ${formatStreak(item.streak, "longest")} |`,
    );
  }
  return lines;
}

function seriesSection(item: SeriesStats): string[] {
  const title = seriesTitle(item.list, item.language, item.period);
  const lines = [`### ${title}`, ""];
  lines.push(
    `${item.daysListed} days listed, ${item.daysNumberOne} days at #1, ${item.daysTop10} days in the top 10. Best rank: ${item.bestEver === null ? "—" : `#${item.bestEver}`}.`,
  );
  lines.push(`Current streak: ${formatStreak(item.streak, "current")}${item.asOf ? `, as of ${item.asOf}` : ""}.`);
  lines.push(`Longest streak: ${formatStreak(item.streak, "longest")}.`);
  const numberOnes = item.days.filter((day) => day.rank === 1).map((day) => day.date);
  if (numberOnes.length > 0) {
    lines.push(`Days at #1: ${numberOnes.join(", ")}.`);
  }
  lines.push("");
  if (item.days.length === 0) return lines;

  const months = monthly(item.days);
  lines.push("| Month | Days | #1 | Top 10 | Best |", "| --- | ---: | ---: | ---: | ---: |");
  for (const month of months) {
    lines.push(`| ${month.month} | ${month.listed} | ${month.numberOne} | ${month.top10} | #${month.best} |`);
  }
  lines.push("");

  const header =
    item.kind === "developer"
      ? ["| Date | Best rank | Featured repo | Source |", "| --- | ---: | --- | --- |"]
      : ["| Date | Best rank | Stars today | Source |", "| --- | ---: | ---: | --- |"];
  lines.push(...header);
  for (const day of [...item.days].reverse()) {
    if (item.kind === "developer") {
      const featured = day.featuredRepo ? `[${day.featuredRepo}](https://github.com/${day.featuredRepo})` : "—";
      lines.push(`| ${day.date} | #${day.rank} | ${featured} | ${day.source} |`);
    } else {
      const stars = day.starsToday === null ? "—" : day.starsToday.toLocaleString("en-US");
      lines.push(`| ${day.date} | #${day.rank} | ${stars} | ${day.source} |`);
    }
  }
  return lines;
}

function monthly(days: DayRank[]): Array<{ month: string; listed: number; numberOne: number; top10: number; best: number }> {
  const groups = new Map<string, DayRank[]>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const bucket = groups.get(month) ?? [];
    bucket.push(day);
    groups.set(month, bucket);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, rows]) => ({
      month,
      listed: rows.length,
      numberOne: rows.filter((row) => row.rank === 1).length,
      top10: rows.filter((row) => row.rank <= 10).length,
      best: Math.min(...rows.map((row) => row.rank)),
    }));
}

export function formatStreak(streak: StreakStats, which: "current" | "longest"): string {
  const length = which === "current" ? streak.current : streak.longest;
  const start = which === "current" ? streak.currentStart : streak.longestStart;
  const end = which === "current" ? streak.currentEnd : streak.longestEnd;
  if (!length || !start || !end) return "0 days";
  if (start === end) return `1 day (${start})`;
  return `${length} days (${start} – ${end})`;
}

export function renderReadmeSummary(report: Report): string {
  const lines = [
    `Updated from the snapshots in [\`data/\`](data/). Full tables, #1 dates, and streaks are in [HISTORY.md](HISTORY.md).`,
    "",
    ...todaySection(report),
    "",
    ...totalsTable([...report.developerSeries, ...report.repoSeries]),
  ];
  return lines.join("\n");
}

export function replaceMarkedSection(document: string, name: string, body: string): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const block = `${start}\n${body.trim()}\n${end}`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (!pattern.test(document)) return `${document.trimEnd()}\n\n${block}\n`;
  return document.replace(pattern, block);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function md(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function writeHistoryFiles(root: string, report: Report): void {
  fs.writeFileSync(path.join(root, "HISTORY.md"), renderHistory(report));
  const readmePath = path.join(root, "README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "# GitHub Trending tracker\n";
  fs.writeFileSync(readmePath, replaceMarkedSection(readme, "history-summary", renderReadmeSummary(report)));
}
