import fs from "node:fs";
import path from "node:path";
import type { TrackingConfig } from "./types.ts";

export function loadConfig(root = process.cwd()): TrackingConfig {
  const file = path.join(root, "config", "tracking.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as TrackingConfig;
  if (!Array.isArray(raw.developers) || !Array.isArray(raw.repoOwners) || !Array.isArray(raw.repoNames)) {
    throw new Error(`Invalid tracking config: ${file}`);
  }
  return raw;
}

export function matchesDeveloper(username: string, config: TrackingConfig): boolean {
  const value = username.toLowerCase();
  return config.developers.some((name) => name.toLowerCase() === value);
}

export function matchesRepo(fullName: string, config: TrackingConfig): boolean {
  const [owner, name] = fullName.split("/");
  if (!owner || !name || fullName.split("/").length !== 2) return false;
  if (config.repoOwners.some((item) => item.toLowerCase() === owner.toLowerCase())) return true;
  if (config.repoNames.some((item) => item.toLowerCase() === name.toLowerCase())) return true;
  return false;
}
