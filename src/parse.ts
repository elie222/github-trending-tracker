import * as cheerio from "cheerio";
import type { DeveloperEntry, ListKind, RepoEntry, TrendingEntry } from "./types.ts";

/**
 * Selectors checked against live GitHub Trending HTML (2026-09-28):
 * each row is `article.Box-row`. Repository rank is document order.
 * Developer rank is the number in the row's first link. Developer
 * username comes from the `h1.h3` profile link. The featured repository
 * is the `h1.h4` link inside the nested article. Star gain is the
 * "N stars today|this week|this month" text.
 */

const STAR_GAIN = /^([\d,]+)\s+stars?\s+(today|this week|this month)$/i;

export function parseTrendingHtml(html: string, list: ListKind): TrendingEntry[] {
  return list === "repos" ? parseRepositories(html) : parseDevelopers(html);
}

export function assertEntries(entries: TrendingEntry[], pageUrl: string): void {
  if (entries.length === 0) {
    throw new Error(
      `Parsed 0 entries from ${pageUrl}. Refusing to treat an empty page as "not trending".`,
    );
  }
}

export function parseRepositories(html: string): RepoEntry[] {
  const $ = cheerio.load(html);
  const entries: RepoEntry[] = [];
  $("article.Box-row").each((index, element) => {
    const row = $(element);
    const href = row.find("h2 a").first().attr("href")?.trim() ?? "";
    const name = href.replace(/^\//, "");
    if (!/^[^/]+\/[^/]+$/.test(name)) return;

    const description = cleanText(row.find("p").first().text()) || null;
    const language = cleanText(row.find('[itemprop="programmingLanguage"]').first().text()) || null;
    const stars = parseCount(row.find('a[href$="/stargazers"]').first().text());
    const forks = parseCount(row.find('a[href$="/forks"]').first().text());
    const gained = starGain($, row);

    entries.push({
      rank: index + 1,
      name,
      url: `https://github.com/${name}`,
      description,
      language,
      stars,
      forks,
      starsToday: gained?.count ?? null,
      starsLabel: gained?.label ?? null,
    });
  });
  return entries;
}

export function parseDevelopers(html: string): DeveloperEntry[] {
  const $ = cheerio.load(html);
  const entries: DeveloperEntry[] = [];
  $("article.Box-row").each((index, element) => {
    const row = $(element);
    const profile = row.find("h1.h3 a").first();
    const href = profile.attr("href")?.trim() ?? "";
    let username = href.replace(/^\//, "").split("/")[0] ?? "";
    if (!username) {
      const id = row.attr("id") ?? "";
      if (id.startsWith("pa-")) username = id.slice(3);
    }
    if (!username || username.includes("/")) return;

    const display = cleanText(profile.text());
    const featuredLink = row.find("h1.h4 a").first();
    let featuredRepo: DeveloperEntry["featuredRepo"] = null;
    const featuredHref = featuredLink.attr("href")?.trim() ?? "";
    const featuredName = featuredHref.replace(/^\//, "");
    if (/^[^/]+\/[^/]+$/.test(featuredName)) {
      const description = cleanText(featuredLink.parent().next("div").text()) || null;
      featuredRepo = {
        name: featuredName,
        url: `https://github.com/${featuredName}`,
        description,
      };
    }

    const rankText = cleanText(row.find("a").first().text());
    const rank = /^\d+$/.test(rankText) ? Number(rankText) : index + 1;

    entries.push({
      rank,
      username,
      name: display || null,
      url: `https://github.com/${username}`,
      featuredRepo,
    });
  });
  return entries;
}

function starGain($: cheerio.CheerioAPI, row: ReturnType<typeof $>): { count: number; label: string } | null {
  let found: { count: number; label: string } | null = null;
  row.find("span").each((_, element) => {
    const text = cleanText($(element).text());
    const match = text.match(STAR_GAIN);
    if (!match) return;
    found = {
      count: Number(match[1].replace(/,/g, "")),
      label: match[2].toLowerCase(),
    };
  });
  return found;
}

function parseCount(text: string): number | null {
  const match = text.replace(/,/g, "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
