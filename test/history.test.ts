import assert from "node:assert/strict";
import test from "node:test";
import { streakStats, buildReport, renderHistory } from "../src/history.ts";
import { developerEntry, repoEntry } from "../src/snapshot.ts";
import type { BackfillManifest, Snapshot, TrackingConfig } from "../src/types.ts";

test("streaks skip unknown days and break on observed absences", () => {
  const listed = new Set(["2026-09-01", "2026-09-03", "2026-09-04"]);
  const skipped = streakStats(listed, new Set(["2026-09-02"]), "2026-09-01", "2026-09-04");
  assert.equal(skipped.current, 3);
  assert.equal(skipped.longest, 3);
  assert.equal(skipped.currentStart, "2026-09-01");
  assert.equal(skipped.currentEnd, "2026-09-04");

  const broken = streakStats(new Set(["2026-09-01", "2026-09-02"]), new Set(), "2026-09-01", "2026-09-04");
  assert.equal(broken.current, 0);
  assert.equal(broken.longest, 2);
  assert.equal(broken.longestStart, "2026-09-01");
  assert.equal(broken.longestEnd, "2026-09-02");

  const single = streakStats(new Set(["2026-09-04"]), new Set(), "2026-09-01", "2026-09-04");
  assert.equal(single.current, 1);
  assert.equal(single.longest, 1);
});

test("history totals use the best daily rank and ignore weekly lists", () => {
  const config: TrackingConfig = {
    developers: ["elie222"],
    repoOwners: ["elie222"],
    repoNames: ["inbox-zero", "rakazo"],
    backfill: {
      archiveRepo: "antonkomarev/github-trending-archive",
      developersSince: "2026-09-01",
      repositoriesSince: "2026-09-01",
    },
  };
  const manifest: BackfillManifest = {
    source: "https://github.com/antonkomarev/github-trending-archive",
    sourceRepo: "antonkomarev/github-trending-archive",
    generatedAt: "2026-09-04T00:00:00.000Z",
    developersSince: "2026-09-01",
    repositoriesSince: "2026-09-01",
    note: "test",
    lists: {
      "developers-typescript-daily": {
        since: "2026-09-01",
        through: "2026-09-04",
        archiveFiles: 4,
        unobserved: ["2026-09-02"],
        trackedSnapshotDays: 3,
      },
      "developers-all-daily": {
        since: "2026-09-01",
        through: "2026-09-04",
        archiveFiles: 4,
        unobserved: [],
        trackedSnapshotDays: 1,
      },
      "repos-typescript-daily": {
        since: "2026-09-01",
        through: "2026-09-04",
        archiveFiles: 4,
        unobserved: [],
        trackedSnapshotDays: 1,
      },
      "repos-all-daily": {
        since: "2026-09-01",
        through: "2026-09-04",
        archiveFiles: 4,
        unobserved: [],
        trackedSnapshotDays: 0,
      },
    },
  };

  const dev = (date: string, rank: number, source: "backfill" | "live" = "backfill"): Snapshot => ({
    schemaVersion: 1,
    date,
    list: "developers",
    language: "typescript",
    period: "daily",
    pageUrl: "https://github.com/trending/developers/typescript?since=daily",
    scrapes: [
      {
        scrapedAt: `${date}T00:00:00.000Z`,
        scrapedAtPrecision: "day",
        source,
        sourceUrl: `https://github.com/antonkomarev/github-trending-archive/blob/master/${date}.json`,
        entries: [developerEntry(rank, "elie222", "elie222/rakazo"), developerEntry(1, "octocat")],
      },
    ],
    best: [],
  });

  const snapshots: Snapshot[] = [
    dev("2026-09-01", 8),
    dev("2026-09-03", 1),
    dev("2026-09-04", 4, "live"),
    {
      schemaVersion: 1,
      date: "2026-09-04",
      list: "developers",
      language: "all",
      period: "daily",
      pageUrl: "https://github.com/trending/developers?since=daily",
      scrapes: [
        {
          scrapedAt: "2026-09-04T00:00:00.000Z",
          scrapedAtPrecision: "day",
          source: "backfill",
          sourceUrl: "https://example.test/all.json",
          entries: [developerEntry(2, "elie222")],
        },
      ],
      best: [],
    },
    {
      schemaVersion: 1,
      date: "2026-09-03",
      list: "repos",
      language: "typescript",
      period: "daily",
      pageUrl: "https://github.com/trending/typescript?since=daily",
      scrapes: [
        {
          scrapedAt: "2026-09-03T00:00:00.000Z",
          scrapedAtPrecision: "day",
          source: "backfill",
          sourceUrl: "https://example.test/repos.json",
          entries: [repoEntry(1, "elie222/inbox-zero")],
        },
      ],
      best: [],
    },
    {
      schemaVersion: 1,
      date: "2026-09-04",
      list: "developers",
      language: "typescript",
      period: "weekly",
      pageUrl: "https://github.com/trending/developers/typescript?since=weekly",
      scrapes: [
        {
          scrapedAt: "2026-09-04T12:00:00.000Z",
          scrapedAtPrecision: "instant",
          source: "live",
          sourceUrl: "https://github.com/trending/developers/typescript?since=weekly",
          entries: [developerEntry(6, "elie222")],
        },
      ],
      best: [],
    },
  ];

  const report = buildReport({ snapshots, manifest, config, today: "2026-09-04" });
  const typescript = report.developerSeries.find((item) => item.language === "typescript")!;
  assert.equal(typescript.daysListed, 3);
  assert.equal(typescript.daysNumberOne, 1);
  assert.equal(typescript.daysTop10, 3);
  assert.equal(typescript.bestEver, 1);
  assert.equal(typescript.onListStreak.current, 3);
  assert.equal(typescript.onListStreak.longest, 3);
  assert.equal(typescript.numberOneStreak.current, 0);
  assert.equal(typescript.numberOneStreak.longest, 1);
  assert.equal(typescript.numberOneStreak.longestStart, "2026-09-03");
  assert.equal(typescript.numberOneStreak.longestEnd, "2026-09-03");

  const all = report.developerSeries.find((item) => item.language === "all")!;
  assert.equal(all.daysListed, 1);
  assert.equal(all.days[0].rank, 2);
  assert.equal(all.onListStreak.current, 1);
  assert.equal(all.numberOneStreak.current, 0);
  assert.equal(all.numberOneStreak.longest, 0);

  const inbox = report.repoSeries.find((item) => item.key === "elie222/inbox-zero" && item.language === "typescript")!;
  assert.equal(inbox.daysNumberOne, 1);
  assert.equal(inbox.numberOneStreak.longest, 1);
  assert.equal(inbox.numberOneStreak.current, 0);
  const rakazo = report.repoSeries.find((item) => item.key === "elie222/rakazo" && item.language === "typescript")!;
  assert.equal(rakazo.daysListed, 0);
  assert.equal(rakazo.onListStreak.longest, 0);
  assert.equal(rakazo.numberOneStreak.longest, 0);

  const markdown = renderHistory(report);
  assert.match(markdown, /TypeScript developers \(daily\)/);
  assert.match(markdown, /all languages developers \(daily\)/);
  assert.match(markdown, /elie222\/rakazo/);
  assert.match(markdown, /backfill/);
  assert.match(markdown, /#1/);
  assert.match(markdown, /Weekly and monthly/);
  assert.match(markdown, /Current on-list streak: 3 days \(2026-09-01 – 2026-09-04\), as of 2026-09-04\./);
  assert.match(markdown, /Longest on-list streak: 3 days \(2026-09-01 – 2026-09-04\)\./);
  assert.match(markdown, /Current #1 streak: 0 days, as of 2026-09-04\./);
  assert.match(markdown, /Longest #1 streak: 1 day \(2026-09-03\)\./);
  assert.match(markdown, /\| Current on-list streak \| Longest on-list streak \| Current #1 streak \| Longest #1 streak \|/);
  assert.doesNotMatch(markdown, /Current streak:/);
  assert.doesNotMatch(markdown, /Longest streak:/);
});

test("number-one streaks skip unknown days and break when the day is not rank 1", () => {
  const config: TrackingConfig = {
    developers: ["elie222"],
    repoOwners: ["elie222"],
    repoNames: ["inbox-zero"],
    backfill: {
      archiveRepo: "antonkomarev/github-trending-archive",
      developersSince: "2026-09-01",
      repositoriesSince: "2026-09-01",
    },
  };
  const manifest: BackfillManifest = {
    source: "https://github.com/antonkomarev/github-trending-archive",
    sourceRepo: "antonkomarev/github-trending-archive",
    generatedAt: "2026-09-05T00:00:00.000Z",
    developersSince: "2026-09-01",
    repositoriesSince: "2026-09-01",
    note: "test",
    lists: {
      "developers-typescript-daily": {
        since: "2026-09-01",
        through: "2026-09-05",
        archiveFiles: 5,
        unobserved: ["2026-09-02"],
        trackedSnapshotDays: 4,
      },
    },
  };
  const dev = (date: string, rank: number): Snapshot => ({
    schemaVersion: 1,
    date,
    list: "developers",
    language: "typescript",
    period: "daily",
    pageUrl: "https://github.com/trending/developers/typescript?since=daily",
    scrapes: [
      {
        scrapedAt: `${date}T00:00:00.000Z`,
        scrapedAtPrecision: "day",
        source: "backfill",
        sourceUrl: `https://github.com/antonkomarev/github-trending-archive/blob/master/${date}.json`,
        entries: [developerEntry(rank, "elie222")],
      },
    ],
    best: [],
  });
  const report = buildReport({
    snapshots: [dev("2026-09-01", 1), dev("2026-09-03", 1), dev("2026-09-04", 2), dev("2026-09-05", 1)],
    manifest,
    config,
    today: "2026-09-05",
  });
  const typescript = report.developerSeries.find((item) => item.language === "typescript")!;
  assert.equal(typescript.onListStreak.current, 4);
  assert.equal(typescript.onListStreak.longest, 4);
  assert.equal(typescript.onListStreak.longestStart, "2026-09-01");
  assert.equal(typescript.onListStreak.longestEnd, "2026-09-05");
  assert.equal(typescript.numberOneStreak.longest, 2);
  assert.equal(typescript.numberOneStreak.longestStart, "2026-09-01");
  assert.equal(typescript.numberOneStreak.longestEnd, "2026-09-03");
  assert.equal(typescript.numberOneStreak.current, 1);
  assert.equal(typescript.numberOneStreak.currentStart, "2026-09-05");
  assert.equal(typescript.numberOneStreak.currentEnd, "2026-09-05");

  const markdown = renderHistory(report);
  assert.match(markdown, /Longest #1 streak: 2 days \(2026-09-01 – 2026-09-03\)\./);
  assert.match(markdown, /Current #1 streak: 1 day \(2026-09-05\), as of 2026-09-05\./);
  assert.match(markdown, /Longest on-list streak: 4 days \(2026-09-01 – 2026-09-05\)\./);
});
