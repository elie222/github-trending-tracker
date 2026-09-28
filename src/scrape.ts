import { pathToFileURL } from "node:url";
import { githubRepository, githubToken, pendingNotifications } from "./alerts.ts";
import { loadConfig } from "./config.ts";
import { utcDate } from "./dates.ts";
import { publishAlerts } from "./github.ts";
import { buildReport, writeHistoryFiles } from "./history.ts";
import { allListSpecs, seriesTitle } from "./lists.ts";
import { assertEntries, parseTrendingHtml } from "./parse.ts";
import { applyScrape, emptySnapshot, isDeveloperEntry } from "./snapshot.ts";
import { loadSnapshots, readAlertState, readManifest, readSnapshot, writeAlertState, writeSnapshot, snapshotPath } from "./store.ts";
import type { DailyBest, TrackingConfig, TrendingEntry } from "./types.ts";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function scrapeAll(options: {
  root?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  delayMs?: number;
  config?: TrackingConfig;
} = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const config = options.config ?? loadConfig(root);
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayMs = options.delayMs ?? 1_500;
  const today = utcDate(now);
  const scrapedAt = now.toISOString();

  const pages: Array<{ spec: ReturnType<typeof allListSpecs>[number]; entries: TrendingEntry[] }> = [];
  const specs = allListSpecs();
  for (let index = 0; index < specs.length; index += 1) {
    if (index > 0) await sleep(delayMs);
    const spec = specs[index];
    const html = await fetchHtml(fetchImpl, spec.pageUrl);
    const entries = parseTrendingHtml(html, spec.list);
    assertEntries(entries, spec.pageUrl);
    const tracked = entries.filter((entry) => isTracked(entry, spec.list, config));
    console.log(
      `${seriesTitle(spec.list, spec.language, spec.period)}: ${entries.length} entries` +
        (tracked.length ? `; tracked ${tracked.map((entry) => describe(entry)).join(", ")}` : ""),
    );
    pages.push({ spec, entries });
  }

  const dailyBests: DailyBest[] = [];
  for (const page of pages) {
    const file = snapshotPath(root, today, page.spec.list, page.spec.language, page.spec.period);
    const existing =
      readSnapshot(file) ??
      emptySnapshot({
        date: today,
        list: page.spec.list,
        language: page.spec.language,
        period: page.spec.period,
        pageUrl: page.spec.pageUrl,
      });
    if (existing.date !== today || existing.list !== page.spec.list) {
      throw new Error(`Refusing to merge scrape into mismatched snapshot ${file}`);
    }
    const { snapshot } = applyScrape(
      existing,
      {
        scrapedAt,
        scrapedAtPrecision: "instant",
        source: "live",
        sourceUrl: page.spec.pageUrl,
        entries: page.entries,
      },
      config,
      { emitEvents: false },
    );
    writeSnapshot(file, snapshot);
    if (page.spec.period === "daily") {
      for (const hit of snapshot.best) {
        dailyBests.push({
          date: today,
          list: snapshot.list,
          language: snapshot.language,
          period: snapshot.period,
          kind: hit.kind,
          key: hit.key,
          url: hit.url,
          bestRank: hit.bestRank,
          starsToday: hit.starsToday,
          featuredRepo: hit.featuredRepo,
        });
      }
    }
  }

  const report = buildReport({
    snapshots: loadSnapshots(root),
    manifest: readManifest(root),
    config,
    today,
  });
  writeHistoryFiles(root, report);

  const state = readAlertState(root, today);
  const events = pendingNotifications(dailyBests, state.notified);
  const token = githubToken();
  const repository = githubRepository();
  if (events.length === 0) {
    console.log("No new daily appearance or best rank. Not opening or commenting on an issue.");
    return;
  }
  if (!token || !repository) {
    console.log("Skipping GitHub issue alerts. Set GITHUB_TOKEN and GITHUB_REPOSITORY to open the daily issue.");
    return;
  }
  const result = await publishAlerts({ token, repository, date: today, bests: dailyBests, events });
  writeAlertState(root, {
    date: today,
    issueNumber: result.issueNumber ?? state.issueNumber,
    notified: [...new Set([...state.notified, ...result.notified])],
  });
}

function isTracked(entry: TrendingEntry, list: "developers" | "repos", config: TrackingConfig): boolean {
  if (list === "developers") {
    return isDeveloperEntry(entry) && config.developers.some((name) => name.toLowerCase() === entry.username.toLowerCase());
  }
  if (isDeveloperEntry(entry)) return false;
  const [owner, name] = entry.name.split("/");
  return (
    config.repoOwners.some((item) => item.toLowerCase() === owner.toLowerCase()) ||
    config.repoNames.some((item) => item.toLowerCase() === name.toLowerCase())
  );
}

function describe(entry: TrendingEntry): string {
  if (isDeveloperEntry(entry)) return `${entry.username}#${entry.rank}`;
  return `${entry.name}#${entry.rank}`;
}

async function fetchHtml(fetchImpl: typeof fetch, pageUrl: string): Promise<string> {
  const response = await fetchImpl(pageUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${pageUrl} failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  if (/abuse detection|rate limit/i.test(html) && !html.includes("Box-row")) {
    throw new Error(`GitHub blocked the scrape of ${pageUrl}`);
  }
  return html;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  scrapeAll().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
