import assert from "node:assert/strict";
import test from "node:test";
import {
  pendingNotifications,
  renderIssueBody,
  signaturesInText,
  syncDailyIssue,
  type IssueStore,
} from "../src/alerts.ts";
import type { DailyBest, RankEvent } from "../src/types.ts";

function best(rank: number, partial: Partial<DailyBest> = {}): DailyBest {
  return {
    date: "2026-09-28",
    list: "developers",
    language: "typescript",
    period: "daily",
    kind: "developer",
    key: "elie222",
    url: "https://github.com/elie222",
    bestRank: rank,
    starsToday: null,
    featuredRepo: "elie222/rakazo",
    ...partial,
  };
}

test("pending alerts fire on first appearance and on a better rank, including #1", () => {
  const first = pendingNotifications([best(9)], []);
  assert.equal(first.length, 1);
  assert.equal(first[0].previousRank, null);
  assert.equal(first[0].rank, 9);

  const same = pendingNotifications([best(9)], ["developers:typescript:elie222:9"]);
  assert.equal(same.length, 0);

  const worse = pendingNotifications([best(12)], ["developers:typescript:elie222:9"]);
  assert.equal(worse.length, 0);

  const numberOne = pendingNotifications([best(1)], ["developers:typescript:elie222:9"]);
  assert.equal(numberOne.length, 1);
  assert.equal(numberOne[0].rank, 1);
  assert.equal(numberOne[0].previousRank, 9);

  const weekly = pendingNotifications([best(1, { period: "weekly" })], []);
  assert.equal(weekly.length, 0);
});

test("one daily issue is created, then only updated when the rank improves", async () => {
  const issues: Array<{ number: number; title: string; body: string; comments: string[] }> = [];
  const store: IssueStore = {
    async findByTitle(title) {
      const found = issues.find((issue) => issue.title === title);
      return found ? { number: found.number, body: found.body } : null;
    },
    async ensureLabel() {},
    async createIssue(input) {
      const record = { number: issues.length + 1, title: input.title, body: input.body, comments: [] };
      issues.push(record);
      return { number: record.number, body: record.body };
    },
    async updateIssue(number, input) {
      const issue = issues.find((item) => item.number === number);
      if (!issue) throw new Error("missing issue");
      issue.body = input.body;
    },
    async listComments(number) {
      const issue = issues.find((item) => item.number === number);
      return (issue?.comments ?? []).map((body) => ({ body }));
    },
    async createComment(number, body) {
      const issue = issues.find((item) => item.number === number);
      if (!issue) throw new Error("missing issue");
      issue.comments.push(body);
    },
  };

  const event = (rank: number, previousRank: number | null): RankEvent => ({
    date: "2026-09-28",
    list: "developers",
    language: "typescript",
    period: "daily",
    kind: "developer",
    key: "elie222",
    url: "https://github.com/elie222",
    rank,
    previousRank,
    starsToday: null,
    featuredRepo: "elie222/rakazo",
  });

  const created = await syncDailyIssue(store, {
    date: "2026-09-28",
    bests: [best(9)],
    events: [event(9, null)],
  });
  assert.equal(created.issueNumber, 1);
  assert.equal(issues[0].comments.length, 0);
  assert.match(issues[0].body, /#9/);
  assert.deepEqual(signaturesInText(issues[0].body), ["developers:typescript:elie222:9"]);

  const repeat = await syncDailyIssue(store, {
    date: "2026-09-28",
    bests: [best(9)],
    events: [event(9, null)],
  });
  assert.equal(repeat.issueNumber, 1);
  assert.equal(issues[0].comments.length, 0);

  const improved = await syncDailyIssue(store, {
    date: "2026-09-28",
    bests: [best(1)],
    events: [event(1, 9)],
  });
  assert.equal(improved.issueNumber, 1);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].comments.length, 1);
  assert.match(issues[0].comments[0], /#1/);
  assert.match(issues[0].body, /tracked-alerts:.*elie222:1/);
  assert.match(renderIssueBody("2026-09-28", [best(1)], improved.notified), /#1/);
});
