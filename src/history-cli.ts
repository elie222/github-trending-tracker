import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.ts";
import { utcDate } from "./dates.ts";
import { buildReport, writeHistoryFiles } from "./history.ts";
import { loadSnapshots, readManifest } from "./store.ts";

function regenerate(root = process.cwd()): void {
  const report = buildReport({
    snapshots: loadSnapshots(root),
    manifest: readManifest(root),
    config: loadConfig(root),
    today: utcDate(),
  });
  writeHistoryFiles(root, report);
  console.log("Regenerated HISTORY.md and the README summary.");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  regenerate();
}
