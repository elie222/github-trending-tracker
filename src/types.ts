export type ListKind = "developers" | "repos";
export type Language = "all" | "typescript";
export type Period = "daily" | "weekly" | "monthly";
export type ScrapeSource = "live" | "backfill";

export interface FeaturedRepo {
  name: string;
  url: string;
  description: string | null;
}

export interface RepoEntry {
  rank: number;
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  forks: number | null;
  /** Stars gained in the page's period. Label says today, this week, or this month. */
  starsToday: number | null;
  starsLabel: string | null;
}

export interface DeveloperEntry {
  rank: number;
  username: string;
  name: string | null;
  url: string;
  featuredRepo: FeaturedRepo | null;
}

export type TrendingEntry = RepoEntry | DeveloperEntry;

export interface Scrape {
  scrapedAt: string;
  /** "instant" for a live scrape. "day" for archive backfill (UTC date only). */
  scrapedAtPrecision: "instant" | "day";
  source: ScrapeSource;
  sourceUrl: string;
  entries: TrendingEntry[];
}

/** Best rank that UTC day for one tracked developer or repository. */
export interface BestRank {
  kind: "developer" | "repo";
  key: string;
  url: string;
  bestRank: number;
  scrapedAt: string;
  starsToday: number | null;
  featuredRepo: string | null;
}

export interface Snapshot {
  schemaVersion: 1;
  date: string;
  list: ListKind;
  language: Language;
  period: Period;
  pageUrl: string;
  scrapes: Scrape[];
  best: BestRank[];
}

export interface TrackingConfig {
  developers: string[];
  repoOwners: string[];
  /** Repository names to track under any owner, e.g. inbox-zero and rakazo. */
  repoNames: string[];
  backfill: {
    archiveRepo: string;
    developersSince: string;
    repositoriesSince: string;
  };
}

export interface ManifestList {
  since: string;
  through: string;
  archiveFiles: number;
  /** Dates in range with no archive file, or an empty list. Unknown, not "not trending". */
  unobserved: string[];
  trackedSnapshotDays: number;
}

export interface BackfillManifest {
  source: string;
  sourceRepo: string;
  generatedAt: string;
  developersSince: string;
  repositoriesSince: string;
  note: string;
  lists: Record<string, ManifestList>;
}

export interface RankEvent {
  date: string;
  list: ListKind;
  language: Language;
  period: Period;
  kind: "developer" | "repo";
  key: string;
  url: string;
  rank: number;
  previousRank: number | null;
  starsToday: number | null;
  featuredRepo: string | null;
}

export interface DailyBest {
  date: string;
  list: ListKind;
  language: Language;
  period: Period;
  kind: "developer" | "repo";
  key: string;
  url: string;
  bestRank: number;
  starsToday: number | null;
  featuredRepo: string | null;
}
