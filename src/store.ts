import fs from "node:fs";
import path from "node:path";
import type { BackfillManifest, Language, ListKind, Period, Snapshot } from "./types.ts";
import { seriesKey } from "./lists.ts";

const SNAPSHOT_FILE = /^(developers|repos)-(all|typescript)-(daily|weekly|monthly)\.json$/;

export function snapshotPath(
  root: string,
  date: string,
  list: ListKind,
  language: Language,
  period: Period,
): string {
  return path.join(root, "data", date.slice(0, 4), date, `${seriesKey(list, language, period)}.json`);
}

export function readSnapshot(file: string): Snapshot | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
}

export function writeSnapshot(file: string, snapshot: Snapshot): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function loadSnapshots(root: string): Snapshot[] {
  const dataDir = path.join(root, "data");
  if (!fs.existsSync(dataDir)) return [];
  const files: string[] = [];
  walk(dataDir, files);
  return files
    .filter((file) => SNAPSHOT_FILE.test(path.basename(file)))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot);
}

export function manifestPath(root: string): string {
  return path.join(root, "data", "backfill-manifest.json");
}

export function readManifest(root: string): BackfillManifest | null {
  const file = manifestPath(root);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as BackfillManifest;
}

export function writeManifest(root: string, manifest: BackfillManifest): void {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
}

export interface AlertState {
  date: string;
  issueNumber: number | null;
  notified: string[];
}

export function alertStatePath(root: string, date: string): string {
  return path.join(root, "data", date.slice(0, 4), date, "alerts.json");
}

export function readAlertState(root: string, date: string): AlertState {
  const file = alertStatePath(root, date);
  if (!fs.existsSync(file)) return { date, issueNumber: null, notified: [] };
  return JSON.parse(fs.readFileSync(file, "utf8")) as AlertState;
}

export function writeAlertState(root: string, state: AlertState): void {
  const file = alertStatePath(root, state.date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}
