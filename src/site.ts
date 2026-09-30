import fs from "node:fs";
import path from "node:path";
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";
import { eachDate } from "./dates.ts";
import { observationWindow, type Report, type SeriesStats } from "./history.ts";
import { isDeveloperEntry } from "./snapshot.ts";
import { loadSnapshots } from "./store.ts";
import type { Language, ListKind, Snapshot } from "./types.ts";

const SITE_ORIGIN = "https://trending.elie.tech";
const DEFAULT_REPOSITORY = "elie222/github-trending-tracker";

export interface ShowcaseRank {
  daysAtOne: number;
  top10: number;
  onList: number;
  longestOneStreak: number;
  longestOnListStreak: number;
  currentStreak: number;
  /** Best rank ever, or null when the developer has never been listed. */
  best: number | null;
  /** Best rank on `report.today`, or null when off the list or unknown. */
  today: number | null;
  todayKnown: boolean;
}

export interface ShowcaseDay {
  date: string;
  ts: number | null;
  all: number | null;
  /** False when that UTC day has no archive file or an empty archived list. */
  tsKnown: boolean;
  allKnown: boolean;
  tsRepo: string | null;
  allRepo: string | null;
}

export interface ShowcaseRepoList {
  label: string;
  color: "yellow" | "blue";
}

export interface ShowcaseRepo {
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  lists: ShowcaseRepoList[];
}

export interface ShowcaseData {
  updatedAt: string | null;
  since: string;
  sinceLabel: string;
  sinceShort: string;
  developer: { login: string; name: string; url: string };
  repositoryUrl: string;
  days: ShowcaseDay[];
  summary: { ts: ShowcaseRank; all: ShowcaseRank };
  repos: ShowcaseRepo[];
}

interface DayStatus {
  known: boolean;
  rank: number | null;
  repo: string | null;
}

export function buildShowcase(report: Report, snapshots: Snapshot[]): ShowcaseData {
  const login = report.config.developers[0] ?? "elie222";
  const typescript = developerSeries(report, "typescript");
  const all = developerSeries(report, "all");
  const tsWindow = windowFor(report, snapshots, "developers", "typescript");
  const allWindow = windowFor(report, snapshots, "developers", "all");
  const bounds = [tsWindow, allWindow].filter((item): item is NonNullable<typeof item> => item !== null);
  const from = bounds.map((item) => item.from).sort()[0] ?? report.config.backfill.developersSince;
  const to = bounds.map((item) => item.to).sort().at(-1) ?? from;

  const days = eachDate(from, to).map((date) => {
    const ts = dayStatus(date, typescript, tsWindow);
    const allDay = dayStatus(date, all, allWindow);
    return {
      date,
      ts: ts.rank,
      all: allDay.rank,
      tsKnown: ts.known,
      allKnown: allDay.known,
      tsRepo: ts.repo,
      allRepo: allDay.repo,
    };
  });

  return {
    updatedAt: latestScrape(snapshots),
    since: from,
    sinceLabel: monthLabel(from, "long"),
    sinceShort: monthLabel(from, "short"),
    developer: developerProfile(snapshots, login),
    repositoryUrl: repositoryUrl(),
    days,
    summary: {
      ts: rankSummary(typescript, dayStatus(report.today, typescript, tsWindow)),
      all: rankSummary(all, dayStatus(report.today, all, allWindow)),
    },
    repos: trendingRepos(report, descriptionsByRepo(snapshots)),
  };
}

export function writeSite(root: string, report: Report): void {
  const data = buildShowcase(report, loadSnapshots(root));
  const docs = path.join(root, "docs");
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, "trending.json"), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(docs, "og.png"), renderOgPng(data, root));

  const indexPath = path.join(docs, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  if (!html.includes("<!-- site-meta:start -->") || !html.includes("<!-- site-meta:end -->")) {
    throw new Error("docs/index.html is missing the site-meta markers");
  }
  fs.writeFileSync(indexPath, replaceMarked(html, "site-meta", renderMeta(data)));
  console.log("Wrote docs/trending.json, docs/og.png, and the social tags in docs/index.html.");
}

export function renderOgPng(data: ShowcaseData, root: string): Buffer {
  const fonts = fontFiles(root);
  for (const file of fonts) {
    if (!fs.existsSync(file)) throw new Error(`Missing font file ${file}`);
  }
  const svg = renderOgSvg(data, fonts);
  const resvg = new Resvg(svg, resvgOptions(fonts, { fitTo: { mode: "width", value: 1200 }, background: "#FDFDFD" }));
  return resvg.render().asPng();
}

export function renderMeta(data: ShowcaseData): string {
  const title = heroTitle(data.summary.ts);
  const description = `${data.summary.ts.onList} days on the list · ${data.summary.ts.top10} in the top 10 · since ${data.sinceLabel}`;
  const image = `${SITE_ORIGIN}/og.png`;
  const page = `${SITE_ORIGIN}/`;
  return [
    `<title>trending.elie.tech</title>`,
    `<meta name="description" content="${escapeAttr(`${title}. ${description}.`)}">`,
    `<link rel="canonical" href="${page}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="trending.elie.tech">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:url" content="${page}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escapeAttr(title)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:image" content="${image}">`,
  ].join("\n");
}

function renderOgSvg(data: ShowcaseData, fonts: string[]): string {
  const width = 1200;
  const height = 630;
  const padX = 64;
  const padTop = 56;
  const padBottom = 48;
  const chartW = width - padX * 2;
  const chartH = 120;
  const chartY = height - padBottom - chartH;
  const headline = `${heroTitle(data.summary.ts)}.`;
  const words = headline.split(/\s+/).filter(Boolean);
  const phrases = ["0"];
  for (let start = 0; start < words.length; start += 1) {
    for (let end = start + 1; end <= words.length; end += 1) phrases.push(words.slice(start, end).join(" "));
  }
  const measured = measureLines(phrases, fonts, "Aeonik", 78, 500, -2.34);
  const measure = (text: string) => measured.get(text) ?? 0;
  const ch = Math.max(1, measured.get("0") ?? 46);
  const lines = wrapBalanced(headline, ch * 15, measure);
  const lineH = 78 * 1.02;
  const blockH = lines.length * lineH + 18 + 32;
  const headerBottom = padTop + 28;
  const mid = headerBottom + (chartY - headerBottom - blockH) / 2;
  const firstBaseline = mid + 62;
  const subBaseline = firstBaseline + (lines.length - 1) * lineH + 18 + 26;

  const headlineSvg = lines
    .map((line, index) => headlineText(line, padX, firstBaseline + index * lineH))
    .join("");

  const chart = ogChart(data, chartW, chartH);
  const who = `${data.developer.name} · @${data.developer.login}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#FDFDFD"/>
  <text x="${padX}" y="${padTop + 22}" font-family="Geist Mono" font-size="22" font-weight="500" fill="#242424">${escapeXml("trending.elie.tech")}</text>
  <text x="${width - padX}" y="${padTop + 22}" text-anchor="end" font-family="Geist" font-size="22" font-weight="400" fill="#6D6E70">${escapeXml(who)}</text>
  ${headlineSvg}
  <text x="${padX}" y="${subBaseline}" font-family="Geist" font-size="26">
    <tspan font-weight="600" fill="#242424">${data.summary.ts.onList}</tspan>
    <tspan font-weight="400" fill="#6D6E70">${escapeXml(" days on the list · ")}</tspan>
    <tspan font-weight="600" fill="#242424">${data.summary.ts.top10}</tspan>
    <tspan font-weight="400" fill="#6D6E70">${escapeXml(" in the top 10")}</tspan>
  </text>
  <g transform="translate(${padX} ${chartY})">${chart}</g>
</svg>`;
}

function ogChart(data: ShowcaseData, width: number, height: number): string {
  const vals = data.days.map((day) => (day.tsKnown ? day.ts : undefined));
  const n = vals.length;
  if (n === 0) return `<rect width="${width}" height="${height}" fill="none"/>`;
  const pad = 8;
  const plotH = height - pad * 2;
  const xAt = (index: number) => (n === 1 ? width / 2 : (index * width) / (n - 1));
  const yAt = (rank: number) => pad + ((rank - 1) * plotH) / 24;
  let path = "";
  let prev = false;
  const golds: Array<{ x: number; y: number }> = [];
  vals.forEach((rank, index) => {
    if (rank === undefined) return;
    if (rank == null) {
      prev = false;
      return;
    }
    const x = xAt(index);
    const y = yAt(rank);
    path += `${prev ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
    prev = true;
    if (rank === 1) golds.push({ x, y });
  });
  const bandH = yAt(10.5);
  const circles = golds
    .map(
      (point) =>
        `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7" fill="#D8A40C" opacity="0.2"/>` +
        `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5" fill="#D8A40C"/>`,
    )
    .join("");
  return `<rect x="0" y="0" width="${width}" height="${bandH.toFixed(1)}" rx="8" fill="#EFF6FF"/>` +
    `<path d="${path || "M0 0"}" fill="none" stroke="#2563EB" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    circles;
}

function headlineText(line: string, x: number, y: number): string {
  const shared = `x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Aeonik" font-size="78" font-weight="500" letter-spacing="-2.34"`;
  if (line.startsWith("#1")) {
    return `<text ${shared}><tspan fill="#2563EB">#1</tspan><tspan fill="#242424">${escapeXml(line.slice(2))}</tspan></text>`;
  }
  return `<text ${shared} fill="#242424">${escapeXml(line)}</text>`;
}

function wrapBalanced(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const count = words.length;
  if (count === 0) return [];
  const widthAt: Array<Array<number | undefined>> = Array.from({ length: count }, () => []);
  for (let start = 0; start < count; start += 1) {
    for (let end = start + 1; end <= count; end += 1) {
      const width = measure(words.slice(start, end).join(" "));
      widthAt[start][end] = width;
      if (width > maxWidth && end > start + 1) break;
    }
  }

  const partitions: string[][] = [];
  const walk = (index: number, lines: string[]) => {
    if (index === count) {
      partitions.push([...lines]);
      return;
    }
    for (let end = index + 1; end <= count; end += 1) {
      const width = widthAt[index][end];
      if (width == null) break;
      if (width > maxWidth && end > index + 1) break;
      lines.push(words.slice(index, end).join(" "));
      walk(end, lines);
      lines.pop();
      if (width > maxWidth) break;
    }
  };
  walk(0, []);
  if (partitions.length === 0) return [text];

  const score = (lines: string[]) => {
    const widths = lines.map((line) => measure(line));
    const mean = widths.reduce((sum, width) => sum + width, 0) / widths.length;
    const variance = widths.reduce((sum, width) => sum + (width - mean) ** 2, 0) / widths.length;
    const last = widths[widths.length - 1] ?? 0;
    const orphan = last < mean * 0.55 ? 80_000 : 0;
    return variance + orphan + lines.length * 500;
  };
  return partitions.sort((a, b) => score(a) - score(b))[0];
}

function measureLines(
  texts: string[],
  fonts: string[],
  family: string,
  size: number,
  weight: number,
  letterSpacing: number,
): Map<string, number> {
  const unique = [...new Set(texts)];
  const rowHeight = Math.ceil(size * 1.8);
  const canvasWidth = 2200;
  const baseline = Math.round(size * 1.15);
  const body = unique
    .map(
      (text, index) =>
        `<text x="0" y="${baseline + index * rowHeight}" fill="#ffffff" font-family="${family}" font-size="${size}" font-weight="${weight}" letter-spacing="${letterSpacing}">${escapeXml(text)}</text>`,
    )
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${rowHeight * unique.length}">` +
    `<rect width="100%" height="100%" fill="#000000"/>${body}</svg>`;
  const image = new Resvg(svg, resvgOptions(fonts)).render();
  const pixels = image.pixels;
  const widths = new Map<string, number>();
  unique.forEach((text, index) => {
    const y0 = index * rowHeight;
    const y1 = y0 + rowHeight;
    let maxX = 0;
    for (let y = y0; y < y1 && y < image.height; y += 1) {
      const row = y * image.width * 4;
      for (let x = 0; x < image.width; x += 1) {
        if (pixels[row + x * 4] > 24 && x > maxX) maxX = x;
      }
    }
    widths.set(text, maxX === 0 ? size : maxX + 1);
  });
  return widths;
}

function resvgOptions(fonts: string[], extra: ResvgRenderOptions = {}): ResvgRenderOptions {
  return {
    font: {
      loadSystemFonts: false,
      fontFiles: fonts,
      defaultFontFamily: "Geist",
      sansSerifFamily: "Geist",
      monospaceFamily: "Geist Mono",
    },
    textRendering: 1,
    shapeRendering: 2,
    ...extra,
  };
}

function fontFiles(root: string): string[] {
  return [
    path.join(root, "assets/fonts/aeonik-medium.ttf"),
    path.join(root, "assets/fonts/geist-400.ttf"),
    path.join(root, "assets/fonts/geist-600.ttf"),
    path.join(root, "assets/fonts/geist-mono-500.ttf"),
  ];
}

function developerSeries(report: Report, language: Language): SeriesStats | undefined {
  const login = report.config.developers[0]?.toLowerCase();
  return report.developerSeries.find(
    (item) => item.period === "daily" && item.language === language && item.key.toLowerCase() === login,
  );
}

function windowFor(report: Report, snapshots: Snapshot[], list: ListKind, language: Language) {
  const dates = snapshots
    .filter((item) => item.list === list && item.language === language && item.period === "daily")
    .map((item) => item.date);
  return observationWindow(report.manifest, list, language, "daily", dates);
}

function dayStatus(date: string, series: SeriesStats | undefined, window: ReturnType<typeof windowFor>): DayStatus {
  if (!series || !window || date < window.from || date > window.to || window.unobserved.has(date)) {
    return { known: false, rank: null, repo: null };
  }
  const day = series.days.find((item) => item.date === date);
  if (!day) return { known: true, rank: null, repo: null };
  return { known: true, rank: day.rank, repo: day.featuredRepo };
}

function rankSummary(series: SeriesStats | undefined, today: DayStatus): ShowcaseRank {
  return {
    daysAtOne: series?.daysNumberOne ?? 0,
    top10: series?.daysTop10 ?? 0,
    onList: series?.daysListed ?? 0,
    longestOneStreak: series?.numberOneStreak.longest ?? 0,
    longestOnListStreak: series?.onListStreak.longest ?? 0,
    currentStreak: series?.onListStreak.current ?? 0,
    best: series?.bestEver ?? null,
    today: today.known ? today.rank : null,
    todayKnown: today.known,
  };
}

function heroTitle(summary: ShowcaseRank): string {
  if (summary.daysAtOne > 0) {
    const word = summary.daysAtOne === 1 ? "day" : "days";
    return `#1 on TypeScript Trending for ${summary.daysAtOne} ${word}`;
  }
  if (summary.best != null) return `#${summary.best} on TypeScript Trending`;
  return "TypeScript Trending";
}

function trendingRepos(report: Report, descriptions: Map<string, string>): ShowcaseRepo[] {
  const repos: ShowcaseRepo[] = [];
  for (const fullName of report.repoNames) {
    const lists: ShowcaseRepoList[] = [];
    for (const language of ["typescript", "all"] as const) {
      const series = report.repoSeries.find(
        (item) =>
          item.period === "daily" &&
          item.language === language &&
          item.key.toLowerCase() === fullName.toLowerCase(),
      );
      if (!series || series.daysListed === 0 || series.bestEver == null) continue;
      lists.push({
        label: language === "typescript" ? `#${series.bestEver} TypeScript repos` : `#${series.bestEver} All-language repos`,
        color: series.bestEver === 1 ? "yellow" : "blue",
      });
    }
    if (lists.length === 0) continue;
    const slash = fullName.indexOf("/");
    repos.push({
      name: slash >= 0 ? fullName.slice(slash + 1) : fullName,
      fullName,
      description: descriptions.get(fullName.toLowerCase()) ?? null,
      url: `https://github.com/${fullName}`,
      lists,
    });
  }
  return repos;
}

function descriptionsByRepo(snapshots: Snapshot[]): Map<string, string> {
  const found = new Map<string, { at: string; description: string }>();
  const consider = (name: string | null | undefined, description: string | null | undefined, at: string) => {
    if (!name || !description) return;
    const key = name.toLowerCase();
    const prev = found.get(key);
    if (!prev || at >= prev.at) found.set(key, { at, description });
  };
  for (const snapshot of snapshots) {
    for (const scrape of snapshot.scrapes) {
      for (const entry of scrape.entries) {
        if (isDeveloperEntry(entry)) consider(entry.featuredRepo?.name, entry.featuredRepo?.description, scrape.scrapedAt);
        else consider(entry.name, entry.description, scrape.scrapedAt);
      }
    }
  }
  return new Map([...found].map(([key, value]) => [key, value.description]));
}

function developerProfile(snapshots: Snapshot[], login: string): { login: string; name: string; url: string } {
  let name = login;
  let url = `https://github.com/${login}`;
  let at = "";
  for (const snapshot of snapshots) {
    if (snapshot.list !== "developers") continue;
    for (const scrape of snapshot.scrapes) {
      for (const entry of scrape.entries) {
        if (!isDeveloperEntry(entry) || entry.username.toLowerCase() !== login.toLowerCase()) continue;
        if (scrape.scrapedAt < at) continue;
        at = scrape.scrapedAt;
        if (entry.name) name = entry.name;
        if (entry.url) url = entry.url;
      }
    }
  }
  return { login, name, url };
}

function latestScrape(snapshots: Snapshot[]): string | null {
  let latest: string | null = null;
  for (const snapshot of snapshots) {
    for (const scrape of snapshot.scrapes) {
      if (!latest || scrape.scrapedAt > latest) latest = scrape.scrapedAt;
    }
  }
  return latest;
}

function monthLabel(isoDate: string, month: "long" | "short"): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month,
    year: "numeric",
  });
}

function repositoryUrl(): string {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv && /^[\w.-]+\/[\w.-]+$/.test(fromEnv)) return `https://github.com/${fromEnv}`;
  return `https://github.com/${DEFAULT_REPOSITORY}`;
}

function replaceMarked(document: string, name: string, body: string): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (!pattern.test(document)) return document;
  return document.replace(pattern, `${start}\n${body.trim()}\n${end}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeXml(value).replace(/"/g, "&quot;");
}
