import { matchesDeveloper, matchesRepo } from "./config.ts";
import type {
  BestRank,
  DeveloperEntry,
  RankEvent,
  RepoEntry,
  Scrape,
  Snapshot,
  TrackingConfig,
  TrendingEntry,
} from "./types.ts";

export function emptySnapshot(
  partial: Pick<Snapshot, "date" | "list" | "language" | "period" | "pageUrl">,
): Snapshot {
  return {
    schemaVersion: 1,
    ...partial,
    scrapes: [],
    best: [],
  };
}

export function isDeveloperEntry(entry: TrendingEntry): entry is DeveloperEntry {
  return "username" in entry;
}

export function applyScrape(
  snapshot: Snapshot,
  scrape: Scrape,
  config: TrackingConfig,
  options: { emitEvents?: boolean } = {},
): { snapshot: Snapshot; events: RankEvent[] } {
  if (
    scrape.source === "backfill" &&
    snapshot.scrapes.some((existing) => existing.source === "backfill" && existing.sourceUrl === scrape.sourceUrl)
  ) {
    return { snapshot, events: [] };
  }

  const before = new Map(snapshot.best.map((hit) => [`${hit.kind}:${hit.key}`, hit.bestRank]));
  const next: Snapshot = {
    ...snapshot,
    scrapes: [...snapshot.scrapes, scrape].sort(
      (a, b) => a.scrapedAt.localeCompare(b.scrapedAt) || a.source.localeCompare(b.source),
    ),
    best: [],
  };
  next.best = recomputeBest(next, config);

  const events: RankEvent[] = [];
  if (options.emitEvents && snapshot.period === "daily") {
    for (const hit of next.best) {
      const previous = before.get(`${hit.kind}:${hit.key}`);
      if (previous === undefined || hit.bestRank < previous) {
        events.push({
          date: snapshot.date,
          list: snapshot.list,
          language: snapshot.language,
          period: snapshot.period,
          kind: hit.kind,
          key: hit.key,
          url: hit.url,
          rank: hit.bestRank,
          previousRank: previous ?? null,
          starsToday: hit.starsToday,
          featuredRepo: hit.featuredRepo,
        });
      }
    }
  }

  return { snapshot: next, events };
}

export function recomputeBest(snapshot: Snapshot, config: TrackingConfig): BestRank[] {
  const hits = new Map<string, BestRank>();
  for (const scrape of snapshot.scrapes) {
    for (const entry of scrape.entries) {
      const hit = toHit(snapshot, entry, scrape, config);
      if (!hit) continue;
      const id = `${hit.kind}:${hit.key}`;
      const prev = hits.get(id);
      if (!prev || hit.bestRank < prev.bestRank) {
        hits.set(id, hit);
        continue;
      }
      if (hit.bestRank === prev.bestRank) {
        hits.set(id, {
          ...prev,
          scrapedAt: prev.scrapedAt <= hit.scrapedAt ? prev.scrapedAt : hit.scrapedAt,
          starsToday: prev.starsToday ?? hit.starsToday,
          featuredRepo: prev.featuredRepo ?? hit.featuredRepo,
          url: prev.url || hit.url,
        });
      }
    }
  }
  return [...hits.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
}

function toHit(
  snapshot: Snapshot,
  entry: TrendingEntry,
  scrape: Scrape,
  config: TrackingConfig,
): BestRank | null {
  if (snapshot.list === "developers") {
    if (!isDeveloperEntry(entry) || !matchesDeveloper(entry.username, config)) return null;
    return {
      kind: "developer",
      key: entry.username,
      url: entry.url,
      bestRank: entry.rank,
      scrapedAt: scrape.scrapedAt,
      starsToday: null,
      featuredRepo: entry.featuredRepo?.name ?? null,
    };
  }
  if (isDeveloperEntry(entry) || !matchesRepo(entry.name, config)) return null;
  return {
    kind: "repo",
    key: entry.name,
    url: entry.url,
    bestRank: entry.rank,
    scrapedAt: scrape.scrapedAt,
    starsToday: entry.starsToday,
    featuredRepo: null,
  };
}

export function repoEntry(rank: number, name: string, starsToday: number | null = null): RepoEntry {
  return {
    rank,
    name,
    url: `https://github.com/${name}`,
    description: null,
    language: null,
    stars: null,
    forks: null,
    starsToday,
    starsLabel: starsToday === null ? null : "today",
  };
}

export function developerEntry(
  rank: number,
  username: string,
  featuredRepo: string | null = null,
): DeveloperEntry {
  return {
    rank,
    username,
    name: null,
    url: `https://github.com/${username}`,
    featuredRepo: featuredRepo
      ? { name: featuredRepo, url: `https://github.com/${featuredRepo}`, description: null }
      : null,
  };
}
