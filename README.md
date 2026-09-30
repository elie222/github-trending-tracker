# GitHub Trending tracker

Daily tracker for GitHub user [elie222](https://github.com/elie222) and that account's repositories, including [inbox-zero](https://github.com/elie222/inbox-zero) and [rakazo](https://github.com/elie222/rakazo). GitHub does not offer a trending API, so this repo scrapes the public HTML and keeps the history here.

Daily lists are the record. Weekly and monthly pages are stored as secondary snapshots.

## What gets scraped

Twelve pages, every six hours via [GitHub Actions](.github/workflows/trending.yml):

| Page | Periods |
| --- | --- |
| [typescript repos](https://github.com/trending/typescript) | daily, weekly, monthly |
| [all-language repos](https://github.com/trending) | daily, weekly, monthly |
| [typescript developers](https://github.com/trending/developers/typescript) | daily, weekly, monthly |
| [all-language developers](https://github.com/trending/developers) | daily, weekly, monthly |

Each row on those pages is an `article.Box-row`. A page can list fewer than 25 repositories. Zero parsed rows fails the job instead of being stored as "not trending". Requests use a browser User-Agent and wait about 1.5 seconds between pages.

Who counts as a hit is configured in [`config/tracking.json`](config/tracking.json):

- developers: `elie222`
- any repository owned by `elie222`
- any repository named `inbox-zero` or `rakazo`, under any owner

## Current standing

<!-- history-summary:start -->
Updated from the snapshots in [`data/`](data/). Full tables, #1 dates, on-list streaks, and #1 streaks are in [HISTORY.md](HISTORY.md).

UTC day **2026-09-30**.

| List | Result |
| --- | --- |
| TypeScript developers (daily) | **#21** elie222 · elie222/rakazo |
| all languages developers (daily) | not listed |
| TypeScript repositories (daily) | not listed |
| all languages repositories (daily) | not listed |

| Name | List | Days listed | Days #1 | Days top 10 | Best | Current on-list streak | Longest on-list streak | Current #1 streak | Longest #1 streak |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| elie222 | TypeScript developers (daily) | 379 | 73 | 275 | #1 | 4 days (2026-09-27 – 2026-09-30) | 27 days (2026-08-16 – 2026-09-11) | 0 days | 8 days (2025-07-08 – 2025-07-15) |
| elie222 | all languages developers (daily) | 162 | 23 | 107 | #1 | 0 days | 8 days (2025-07-08 – 2025-07-15) | 0 days | 3 days (2025-10-22 – 2025-10-24) |
| elie222/inbox-zero | TypeScript repositories (daily) | 22 | 3 | 16 | #1 | 0 days | 4 days (2025-04-03 – 2025-04-06) | 0 days | 2 days (2025-04-04 – 2025-04-05) |
| elie222/inbox-zero | all languages repositories (daily) | 6 | 0 | 5 | #2 | 0 days | 3 days (2025-04-03 – 2025-04-05) | 0 days | 0 days |
| elie222/rakazo | TypeScript repositories (daily) | 0 | 0 | 0 | — | 0 days | 0 days | 0 days | 0 days |
| elie222/rakazo | all languages repositories (daily) | 0 | 0 | 0 | — | 0 days | 0 days | 0 days | 0 days |
<!-- history-summary:end -->

## Data

Snapshots are committed back to this repo, one file per list per UTC day:

```text
data/YYYY/YYYY-MM-DD/<list>-<language>-<period>.json
```

Example: `data/2026/2026-09-28/developers-typescript-daily.json`.

Each file keeps **every scrape** from that day (`scrapes[]`, with rank, name, URL, stars today, the featured repository for a developer, and `scrapedAt`). `best` is the best rank that day for each tracked developer or repository. Live scrapes use an exact UTC timestamp. Backfilled scrapes are marked `"source": "backfill"` and use the archive date as the timestamp.

`data/backfill-manifest.json` records which archive dates were scanned. `data/YYYY/YYYY-MM-DD/alerts.json` records which daily ranks were already sent to the GitHub issue, so later runs the same day do not comment again.

## Alerts

On a **daily** list, the workflow opens one GitHub issue per UTC day (label `trending`, title `Trending daily YYYY-MM-DD`) when a tracked developer or repository shows up, and comments when a later scrape that day reaches a better rank, including **#1**. The same rank on the next run does not add a comment. Weekly and monthly snapshots do not open issues.

The workflow uses the built-in `GITHUB_TOKEN` with `contents: write` (to commit snapshots) and `issues: write` (to open the issue). No extra secrets.

## History

[HISTORY.md](HISTORY.md) is regenerated on every scrape. It leads with TypeScript daily and all-languages daily ranks for `elie222`, then totals (days listed, days at #1, days in the top 10), on-list streaks, #1 streaks, and repository appearances.

Backfill comes from the public archive [antonkomarev/github-trending-archive](https://github.com/antonkomarev/github-trending-archive): developers since 2024-11-17, repositories since 2021-12-31, TypeScript and all languages. Those dates are the archive's UTC scrape dates. The archive does not store star counts or featured repositories. All-languages repository files in that archive start later than the TypeScript repository files; the manifest records the gap. Missing or empty archive days are unknown and do not break on-list streaks or #1 streaks.

## Showcase

[`docs/`](docs/) is the public page for [trending.elie.tech](https://trending.elie.tech): the headline, six stats, a chart that switches between month-by-month bars, total #1 days, and daily rank (TypeScript and all languages, 30D / 90D / 1Y / All), the calendar, repositories that trended, and `docs/og.png` (1200×630). Numbers come from the snapshots in `data/`, using the same best daily rank and the same rule for archive days: a missing or empty archive date stays unknown and is not drawn as a day off the list.

`npm run history` and the scrape workflow regenerate `docs/trending.json`, `docs/og.png`, and the social tags in `docs/index.html` after they refresh `HISTORY.md`. `npm run site` rebuilds only the page. `vercel.json` serves `docs/` as the static output, with no install and no build.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm test
```

Scrape the live pages (writes today's snapshots and regenerates the history). Without `GITHUB_TOKEN` and `GITHUB_REPOSITORY`, alerts are skipped.

```bash
npm run scrape
```

Backfill from a local clone of the archive, then regenerate history:

```bash
git clone --depth 1 https://github.com/antonkomarev/github-trending-archive.git /tmp/github-trending-archive
npm run backfill -- --archive /tmp/github-trending-archive
```

`npm run backfill` without `--archive` clones that repository into a temp directory. Re-running backfill does not duplicate archive scrapes.

Regenerate `HISTORY.md` and the summary above from files already in `data/`:

```bash
npm run history
```

## Tests

`npm test` parses saved HTML fixtures in `test/fixtures/` (trimmed from live GitHub Trending pages) and checks rank merging, streaks, and the once-per-day issue behavior.
