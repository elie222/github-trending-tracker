import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertEntries, parseDevelopers, parseRepositories, parseTrendingHtml } from "../src/parse.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("parses repository rows: rank, name, url, stars today", () => {
  const html = fs.readFileSync(path.join(fixtures, "repos-typescript.html"), "utf8");
  const entries = parseRepositories(html);
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) => entry.rank),
    [1, 2, 3],
  );
  assert.equal(entries[0].name, "paperclipai/paperclip");
  assert.equal(entries[0].url, "https://github.com/paperclipai/paperclip");
  assert.equal(entries[0].description, "The open-source app everyone uses to manage agents at work");
  assert.equal(entries[0].language, "TypeScript");
  assert.equal(entries[0].stars, 92210);
  assert.equal(entries[0].forks, 15843);
  assert.equal(entries[0].starsToday, 3185);
  assert.equal(entries[0].starsLabel, "today");
  assert.equal(entries[1].name, "mvschwarz/openrig");
  assert.equal(entries[1].starsToday, 781);
  assert.equal(entries[1].stars, 1536);
});

test("parses developer rows: displayed rank, display name, featured repo", () => {
  const html = fs.readFileSync(path.join(fixtures, "developers-typescript.html"), "utf8");
  const entries = parseDevelopers(html);
  assert.deepEqual(
    entries.map((entry) => [entry.rank, entry.username]),
    [
      [1, "PerryLink"],
      [2, "cv"],
      [9, "elie222"],
    ],
  );

  const elie = entries[2];
  assert.equal(elie.name, "Elie Steinbock");
  assert.equal(elie.url, "https://github.com/elie222");
  assert.equal(elie.featuredRepo?.name, "elie222/rakazo");
  assert.equal(elie.featuredRepo?.url, "https://github.com/elie222/rakazo");
  assert.match(elie.featuredRepo?.description ?? "", /Grok Bot/);

  assert.equal(entries[1].name, "Carlos Villela");
  assert.equal(entries[1].username, "cv");
  assert.equal(entries[0].featuredRepo?.name, "PerryLink/jevcore");
});

test("zero parsed entries is an error, not an empty chart", () => {
  const html = fs.readFileSync(path.join(fixtures, "empty.html"), "utf8");
  assert.deepEqual(parseTrendingHtml(html, "repos"), []);
  assert.deepEqual(parseTrendingHtml(html, "developers"), []);
  assert.throws(() => assertEntries([], "https://github.com/trending/typescript?since=daily"), /0 entries/);
});

test("developer without a featured repo and a repo without a star gain", () => {
  const developers = parseDevelopers(`
    <article class="Box-row" id="pa-octocat">
      <a href="#pa-octocat">4</a>
      <h1 class="h3"><a href="/octocat">The Octocat</a></h1>
    </article>
  `);
  assert.equal(developers.length, 1);
  assert.equal(developers[0].rank, 4);
  assert.equal(developers[0].username, "octocat");
  assert.equal(developers[0].name, "The Octocat");
  assert.equal(developers[0].featuredRepo, null);

  const repos = parseRepositories(`
    <article class="Box-row">
      <h2 class="h3"><a href="/acme/widget">acme / widget</a></h2>
      <p>A widget</p>
      <a href="/acme/widget/stargazers">12</a>
      <a href="/acme/widget/forks">2</a>
    </article>
  `);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].name, "acme/widget");
  assert.equal(repos[0].stars, 12);
  assert.equal(repos[0].forks, 2);
  assert.equal(repos[0].starsToday, null);
});

test("singular star gain", () => {
  const repos = parseRepositories(`
    <article class="Box-row">
      <h2 class="h3"><a href="/acme/widget">acme / widget</a></h2>
      <span class="d-inline-block float-sm-right">1 star this week</span>
    </article>
  `);
  assert.equal(repos[0].starsToday, 1);
  assert.equal(repos[0].starsLabel, "this week");
});
