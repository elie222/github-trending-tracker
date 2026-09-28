import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { loadConfig, matchesDeveloper, matchesRepo } from "./config.ts";
import { eachDate, utcDate } from "./dates.ts";
import { buildReport, writeHistoryFiles } from "./history.ts";
import { seriesKey } from "./lists.ts";
import { applyScrape, developerEntry, emptySnapshot, repoEntry } from "./snapshot.ts";
import { loadSnapshots, readSnapshot, snapshotPath, writeManifest, writeSnapshot } from "./store.ts";
import type { Language, ListKind, ManifestList, Scrape, TrackingConfig } from "./types.ts";

const execFileAsync = promisify(execFile);

interface ArchiveSpec {
  list: ListKind;
  language: Language;
  archiveKind: "developer" | "repository";
  fileName: string;
  since: string;
}

interface ArchiveFile {
  date: string;
  names: string[];
  relativePosix: string;
}

export async function backfill(options: { root?: string; archive?: string; now?: Date } = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const config = loadConfig(root);
  const archive = options.archive ?? (await cloneArchive(config));
  const specs = archiveSpecs(config);
  const lists: Record<string, ManifestList> = {};

  for (const spec of specs) {
    const files = readArchive(archive, spec);
    const present = new Set(files.map((file) => file.date));
    const dated = [...present].sort();
    const through = dated.at(-1);
    if (!through) throw new Error(`No archive files for ${spec.archiveKind} ${spec.fileName}`);
    const unobserved: string[] = [];
    for (const date of eachDate(spec.since, through)) {
      if (!present.has(date)) unobserved.push(date);
    }

    let trackedDays = 0;
    for (const file of files) {
      if (file.date < spec.since || file.date > through) continue;
      if (file.names.length === 0) {
        unobserved.push(file.date);
        continue;
      }
      const entries =
        spec.list === "developers"
          ? file.names.map((username, index) => developerEntry(index + 1, username))
          : file.names.map((name, index) => repoEntry(index + 1, name));
      const tracked = entries.some((entry) =>
        spec.list === "developers"
          ? "username" in entry && matchesDeveloper(entry.username, config)
          : "name" in entry && !("username" in entry) && matchesRepo(entry.name, config),
      );
      if (!tracked) continue;
      trackedDays += 1;
      const sourceUrl = archiveUrl(config.backfill.archiveRepo, file);
      const scrape: Scrape = {
        scrapedAt: `${file.date}T00:00:00.000Z`,
        scrapedAtPrecision: "day",
        source: "backfill",
        sourceUrl,
        entries,
      };
      const dest = snapshotPath(root, file.date, spec.list, spec.language, "daily");
      const existing =
        readSnapshot(dest) ??
        emptySnapshot({
          date: file.date,
          list: spec.list,
          language: spec.language,
          period: "daily",
          pageUrl: pageUrl(spec),
        });
      const { snapshot } = applyScrape(existing, scrape, config, { emitEvents: false });
      writeSnapshot(dest, snapshot);
    }

    const key = seriesKey(spec.list, spec.language, "daily");
    lists[key] = {
      since: spec.since,
      through,
      archiveFiles: files.filter((file) => file.date >= spec.since && file.date <= through).length,
      unobserved: [...new Set(unobserved)].sort(),
      trackedSnapshotDays: trackedDays,
    };
    console.log(
      `${key}: ${lists[key].archiveFiles} archive files, ${trackedDays} tracked days, ${lists[key].unobserved.length} unobserved`,
    );
  }

  const allRepo = lists["repos-all-daily"];
  writeManifest(root, {
    source: `https://github.com/${config.backfill.archiveRepo}`,
    sourceRepo: config.backfill.archiveRepo,
    generatedAt: (options.now ?? new Date()).toISOString(),
    developersSince: config.backfill.developersSince,
    repositoriesSince: config.backfill.repositoriesSince,
    note: [
      "Snapshot files are written only for UTC days a tracked developer or repository appeared.",
      "Each backfill scrape is source=backfill and points at the archive JSON.",
      "Empty archive lists and missing dates are unobserved: they are not treated as an absence from the chart, and they do not break on-list streaks or #1 streaks.",
      allRepo
        ? `All-languages repository coverage in the archive runs ${firstObserved(allRepo)} through ${allRepo.through}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    lists,
  });

  const report = buildReport({
    snapshots: loadSnapshots(root),
    manifest: JSON.parse(fs.readFileSync(path.join(root, "data", "backfill-manifest.json"), "utf8")),
    config,
    today: utcDate(options.now ?? new Date()),
  });
  writeHistoryFiles(root, report);
  console.log("Wrote HISTORY.md and the README summary.");
}

function firstObserved(list: ManifestList): string {
  const missing = new Set(list.unobserved);
  for (const date of eachDate(list.since, list.through)) {
    if (!missing.has(date)) return date;
  }
  return list.since;
}

function archiveSpecs(config: TrackingConfig): ArchiveSpec[] {
  return [
    {
      list: "developers",
      language: "typescript",
      archiveKind: "developer",
      fileName: "typescript.json",
      since: config.backfill.developersSince,
    },
    {
      list: "developers",
      language: "all",
      archiveKind: "developer",
      fileName: "(null).json",
      since: config.backfill.developersSince,
    },
    {
      list: "repos",
      language: "typescript",
      archiveKind: "repository",
      fileName: "typescript.json",
      since: config.backfill.repositoriesSince,
    },
    {
      list: "repos",
      language: "all",
      archiveKind: "repository",
      fileName: "(null).json",
      since: config.backfill.repositoriesSince,
    },
  ];
}

function readArchive(archiveRoot: string, spec: ArchiveSpec): ArchiveFile[] {
  const base = path.join(archiveRoot, "archive", spec.archiveKind);
  if (!fs.existsSync(base)) throw new Error(`Archive directory not found: ${base}`);
  const files: ArchiveFile[] = [];
  for (const year of fs.readdirSync(base)) {
    const yearDir = path.join(base, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    for (const date of fs.readdirSync(yearDir)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const file = path.join(yearDir, date, spec.fileName);
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { date?: string; list?: string[] };
      const names = parsed.list ?? [];
      if (!Array.isArray(names) || names.some((item) => typeof item !== "string")) {
        throw new Error(`Unexpected archive JSON: ${file}`);
      }
      files.push({
        date: parsed.date || date,
        names,
        relativePosix: `archive/${spec.archiveKind}/${year}/${date}/${spec.fileName}`,
      });
    }
  }
  files.sort((a, b) => a.date.localeCompare(b.date));
  return files;
}

function archiveUrl(repo: string, file: ArchiveFile): string {
  const encoded = file.relativePosix
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://github.com/${repo}/blob/master/${encoded}`;
}

function pageUrl(spec: ArchiveSpec): string {
  const since = "daily";
  if (spec.list === "repos") {
    return spec.language === "all"
      ? `https://github.com/trending?since=${since}`
      : `https://github.com/trending/typescript?since=${since}`;
  }
  return spec.language === "all"
    ? `https://github.com/trending/developers?since=${since}`
    : `https://github.com/trending/developers/typescript?since=${since}`;
}

async function cloneArchive(config: TrackingConfig): Promise<string> {
  const dest = path.join(os.tmpdir(), "github-trending-archive");
  if (fs.existsSync(path.join(dest, "archive", "developer"))) return dest;
  console.log(`Cloning ${config.backfill.archiveRepo} into ${dest}`);
  await execFileAsync("git", ["clone", "--depth", "1", `https://github.com/${config.backfill.archiveRepo}.git`, dest]);
  return dest;
}

function parseArgs(argv: string[]): { archive?: string } {
  const archiveFlag = argv.indexOf("--archive");
  if (archiveFlag === -1) return {};
  const archive = argv[archiveFlag + 1];
  if (!archive) throw new Error("--archive requires a path");
  return { archive };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  backfill(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
