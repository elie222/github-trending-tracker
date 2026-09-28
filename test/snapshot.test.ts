import assert from "node:assert/strict";
import test from "node:test";
import { matchesDeveloper, matchesRepo } from "../src/config.ts";
import { applyScrape, developerEntry, emptySnapshot, repoEntry } from "../src/snapshot.ts";
import type { Scrape, TrackingConfig } from "../src/types.ts";

const config: TrackingConfig = {
  developers: ["elie222"],
  repoOwners: ["elie222"],
  repoNames: ["inbox-zero", "rakazo"],
  backfill: {
    archiveRepo: "antonkomarev/github-trending-archive",
    developersSince: "2024-11-17",
    repositoriesSince: "2021-12-31",
  },
};

function scrape(entries: Scrape["entries"], source: Scrape["source"] = "live", at = "2026-09-28T12:00:00.000Z"): Scrape {
  return {
    scrapedAt: at,
    scrapedAtPrecision: source === "backfill" ? "day" : "instant",
    source,
    sourceUrl: source === "backfill" ? "https://example.test/archive.json" : "https://github.com/trending/developers/typescript?since=daily",
    entries,
  };
}

test("tracking config matches owners, named repos, and developers", () => {
  assert.equal(matchesDeveloper("Elie222", config), true);
  assert.equal(matchesDeveloper("someone", config), false);
  assert.equal(matchesRepo("elie222/inbox-zero", config), true);
  assert.equal(matchesRepo("elie222/other-project", config), true);
  assert.equal(matchesRepo("other/rakazo", config), true);
  assert.equal(matchesRepo("other/unrelated", config), false);
});

test("best rank is the minimum across scrapes and only improves alerts", () => {
  let current = emptySnapshot({
    date: "2026-09-28",
    list: "developers",
    language: "typescript",
    period: "daily",
    pageUrl: "https://github.com/trending/developers/typescript?since=daily",
  });

  let result = applyScrape(current, scrape([developerEntry(9, "elie222", "elie222/rakazo"), developerEntry(1, "octocat")]), config, {
    emitEvents: true,
  });
  current = result.snapshot;
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].key, "elie222");
  assert.equal(result.events[0].rank, 9);
  assert.equal(result.events[0].previousRank, null);
  assert.equal(current.best[0].featuredRepo, "elie222/rakazo");
  assert.equal(current.scrapes[0].entries.length, 2);

  result = applyScrape(current, scrape([developerEntry(9, "elie222")], "live", "2026-09-28T16:00:00.000Z"), config, {
    emitEvents: true,
  });
  current = result.snapshot;
  assert.equal(result.events.length, 0);
  assert.equal(current.scrapes.length, 2);
  assert.equal(current.best[0].bestRank, 9);

  result = applyScrape(current, scrape([developerEntry(1, "elie222", "elie222/rakazo")], "live", "2026-09-28T20:00:00.000Z"), config, {
    emitEvents: true,
  });
  current = result.snapshot;
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].rank, 1);
  assert.equal(result.events[0].previousRank, 9);
  assert.equal(current.best[0].bestRank, 1);

  result = applyScrape(current, scrape([developerEntry(4, "elie222")], "live", "2026-09-28T22:00:00.000Z"), config, {
    emitEvents: true,
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.snapshot.best[0].bestRank, 1);
  assert.equal(result.snapshot.scrapes.length, 4);
});

test("weekly scrapes are stored but do not emit daily alerts", () => {
  const snapshot = emptySnapshot({
    date: "2026-09-28",
    list: "repos",
    language: "typescript",
    period: "weekly",
    pageUrl: "https://github.com/trending/typescript?since=weekly",
  });
  const result = applyScrape(snapshot, scrape([repoEntry(3, "elie222/inbox-zero", 40), repoEntry(1, "other/rakazo", 10)]), config, {
    emitEvents: true,
  });
  assert.equal(result.events.length, 0);
  assert.deepEqual(
    result.snapshot.best.map((hit) => [hit.key, hit.bestRank]),
    [
      ["elie222/inbox-zero", 3],
      ["other/rakazo", 1],
    ],
  );
});

test("backfill scrapes are not duplicated", () => {
  const snapshot = emptySnapshot({
    date: "2026-09-27",
    list: "repos",
    language: "all",
    period: "daily",
    pageUrl: "https://github.com/trending?since=daily",
  });
  const archived = scrape([repoEntry(5, "elie222/inbox-zero")], "backfill", "2026-09-27T00:00:00.000Z");
  const first = applyScrape(snapshot, archived, config);
  const second = applyScrape(first.snapshot, archived, config);
  assert.equal(second.snapshot.scrapes.length, 1);
  assert.equal(second.snapshot.best[0].bestRank, 5);
});
