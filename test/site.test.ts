import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { addDays } from "../src/dates.ts";
import { buildReport } from "../src/history.ts";
import { developerEntry, repoEntry } from "../src/snapshot.ts";
import { buildShowcase, renderOgPng } from "../src/site.ts";
import { loadConfig } from "../src/config.ts";
import { loadSnapshots, readManifest } from "../src/store.ts";
import type { BackfillManifest, Snapshot, TrackingConfig } from "../src/types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function config(): TrackingConfig {
  return {
    developers: ["elie222"],
    repoOwners: ["elie222"],
    repoNames: ["inbox-zero", "rakazo"],
    backfill: {
      archiveRepo: "antonkomarev/github-trending-archive",
      developersSince: "2026-09-01",
      repositoriesSince: "2026-09-01",
    },
  };
}

function manifest(): BackfillManifest {
  return {
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
}

function dev(date: string, rank: number, repo: string | null = null): Snapshot {
  return {
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
        sourceUrl: "https://example.test/archive.json",
        entries: [developerEntry(rank, "elie222", repo)],
      },
    ],
    best: [],
  };
}

test("showcase keeps unknown archive days and matches history streaks", () => {
  const snapshots: Snapshot[] = [
    dev("2026-09-01", 8, "elie222/inbox-zero"),
    dev("2026-09-03", 1, "elie222/rakazo"),
    dev("2026-09-04", 4, "elie222/inbox-zero"),
    {
      schemaVersion: 1,
      date: "2026-09-04",
      list: "developers",
      language: "all",
      period: "daily",
      pageUrl: "https://github.com/trending/developers?since=daily",
      scrapes: [
        {
          scrapedAt: "2026-09-04T08:00:00.000Z",
          scrapedAtPrecision: "instant",
          source: "live",
          sourceUrl: "https://github.com/trending/developers?since=daily",
          entries: [developerEntry(2, "elie222", "elie222/rakazo")],
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
  ];
  const report = buildReport({ snapshots, manifest: manifest(), config: config(), today: "2026-09-04" });
  const page = buildShowcase(report, snapshots);
  const typescript = report.developerSeries.find((item) => item.language === "typescript")!;

  assert.deepEqual(page.days.map((day) => day.date), ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
  assert.equal(page.days[1].tsKnown, false);
  assert.equal(page.days[1].ts, null);
  assert.equal(page.days[0].ts, 8);
  assert.equal(page.days[0].tsRepo, "elie222/inbox-zero");
  assert.equal(page.days[0].allKnown, true);
  assert.equal(page.days[0].all, null);
  assert.equal(page.days[3].all, 2);
  assert.equal(page.days[3].allRepo, "elie222/rakazo");
  assert.equal(page.summary.ts.daysAtOne, typescript.daysNumberOne);
  assert.equal(page.summary.ts.onList, typescript.daysListed);
  assert.equal(page.summary.ts.top10, typescript.daysTop10);
  assert.equal(page.summary.ts.longestOneStreak, typescript.numberOneStreak.longest);
  assert.equal(page.summary.ts.longestOnListStreak, typescript.onListStreak.longest);
  assert.equal(page.summary.ts.currentStreak, typescript.onListStreak.current);
  assert.equal(page.summary.ts.currentStreak, 3);
  assert.equal(page.summary.ts.today, 4);
  assert.equal(page.summary.ts.todayKnown, true);
  assert.deepEqual(page.repos.map((repo) => repo.fullName), ["elie222/inbox-zero"]);
  assert.deepEqual(page.repos[0].lists, [{ label: "#1 TypeScript repos", color: "yellow" }]);
  assert.equal(page.updatedAt, "2026-09-04T08:00:00.000Z");
  assert.equal(page.sinceLabel, "September 2026");
});

test("committed snapshots drive the showcase without relabeling archive gaps", () => {
  const snapshots = loadSnapshots(root);
  const report = buildReport({
    snapshots,
    manifest: readManifest(root),
    config: loadConfig(root),
    today: "2026-09-29",
  });
  const page = buildShowcase(report, snapshots);
  const typescript = report.developerSeries.find((item) => item.language === "typescript" && item.period === "daily")!;
  const all = report.developerSeries.find((item) => item.language === "all" && item.period === "daily")!;

  assert.equal(page.summary.ts.daysAtOne, typescript.daysNumberOne);
  assert.equal(page.summary.ts.onList, typescript.daysListed);
  assert.equal(page.summary.ts.top10, typescript.daysTop10);
  assert.equal(page.summary.ts.longestOneStreak, typescript.numberOneStreak.longest);
  assert.equal(page.summary.ts.currentStreak, typescript.onListStreak.current);
  assert.equal(page.summary.ts.best, typescript.bestEver);
  assert.equal(page.summary.all.onList, all.daysListed);
  assert.equal(page.summary.all.daysAtOne, all.daysNumberOne);
  assert.ok(page.days.length > 600);
  for (let index = 1; index < page.days.length; index += 1) {
    assert.equal(addDays(page.days[index - 1].date, 1), page.days[index].date);
  }

  const missingTypescript = page.days.find((day) => day.date === "2026-07-03");
  assert.ok(missingTypescript);
  assert.equal(missingTypescript.tsKnown, false);
  assert.equal(missingTypescript.allKnown, true);

  const listed = new Set(typescript.days.map((day) => day.date));
  const off = page.days.find((day) => day.tsKnown && day.ts == null);
  assert.ok(off);
  assert.equal(listed.has(off.date), false);

  const ranked = typescript.days.find((day) => day.featuredRepo);
  assert.ok(ranked);
  const row = page.days.find((day) => day.date === ranked.date);
  assert.equal(row?.ts, ranked.rank);
  assert.equal(row?.tsRepo, ranked.featuredRepo);

  assert.ok(page.repos.some((repo) => repo.fullName === "elie222/inbox-zero" && repo.lists.some((item) => item.label === "#1 TypeScript repos")));
  assert.equal(page.repos.some((repo) => repo.fullName === "elie222/rakazo"), false);
  assert.equal(page.developer.name, "Elie Steinbock");
  assert.equal(page.since, "2024-11-17");
  assert.equal(page.sinceLabel, "November 2024");
  assert.equal(page.updatedAt, [...snapshots.flatMap((snapshot) => snapshot.scrapes.map((scrape) => scrape.scrapedAt))].sort().at(-1));
});

test("open graph image is a 1200x630 png", () => {
  const snapshots = [dev("2026-09-01", 1, "elie222/inbox-zero"), dev("2026-09-03", 4)];
  const report = buildReport({ snapshots, manifest: manifest(), config: config(), today: "2026-09-03" });
  const png = renderOgPng(buildShowcase(report, snapshots), root);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
