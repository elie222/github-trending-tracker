import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.ts";
import { utcDate } from "./dates.ts";
import { buildReport } from "./history.ts";
import { writeSite } from "./site.ts";
import { loadSnapshots, readManifest } from "./store.ts";

function regenerate(root = process.cwd()): void {
  const report = buildReport({
    snapshots: loadSnapshots(root),
    manifest: readManifest(root),
    config: loadConfig(root),
    today: utcDate(),
  });
  writeSite(root, report);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  regenerate();
}
