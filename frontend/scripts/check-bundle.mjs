// JavaScript budget per page, measured on the production build (`out/`).
//
//   npm run build && npm run check:bundle        fail if a page grew
//   npm run check:bundle -- --update             re-record after shrinking
//
// For each exported page it sums the gzip size of every script the HTML
// loads. `bundle-budget.json` holds the recorded size per page; a page may
// not exceed its recorded size by more than SLACK_KB. Like the accessibility
// baseline this is a ratchet: update it when pages get lighter, not heavier.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT = "out";
const BUDGET_FILE = "bundle-budget.json";
const SLACK_KB = 10;
const update = process.argv.includes("--update");

if (!fs.existsSync(path.join(OUT, "index.html"))) {
  console.error(`No build in ${OUT}/ — run \`npm run build\` first.`);
  process.exit(1);
}

const gzipCache = new Map();
function gzipSize(file) {
  if (!gzipCache.has(file)) gzipCache.set(file, zlib.gzipSync(fs.readFileSync(path.join(OUT, file))).length);
  return gzipCache.get(file);
}

const pages = fs
  .readdirSync(OUT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(OUT, d.name, "index.html")))
  .map((d) => `/${d.name}/`)
  .filter((p) => !p.startsWith("/_"));
pages.unshift("/");

const measured = {};
for (const page of pages.sort()) {
  const html = fs.readFileSync(path.join(OUT, page, "index.html"), "utf8");
  const scripts = [...new Set([...html.matchAll(/src="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1]))];
  measured[page] = Math.round(scripts.reduce((sum, f) => sum + gzipSize(f), 0) / 1024);
}

if (update) {
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(measured, null, 2) + "\n");
  console.log(`Recorded ${Object.keys(measured).length} pages in ${BUDGET_FILE}.`);
  process.exit(0);
}

const budget = fs.existsSync(BUDGET_FILE) ? JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")) : {};
const failures = [];
console.log("page".padEnd(16), "now".padStart(6), "budget".padStart(8));
for (const [page, kb] of Object.entries(measured)) {
  const allowed = budget[page];
  const over = allowed == null ? false : kb > allowed + SLACK_KB;
  console.log(page.padEnd(16), `${kb} KB`.padStart(6), (allowed == null ? "new" : `${allowed} KB`).padStart(8), over ? " ← over budget" : "");
  if (allowed == null) failures.push(`${page} has no budget yet — run \`npm run check:bundle -- --update\` and commit the file.`);
  else if (over) failures.push(`${page}: ${kb} KB gzip, budget ${allowed} KB (+${SLACK_KB} KB slack).`);
}
if (failures.length) {
  console.error("\nJavaScript budget exceeded:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("\nAll pages within budget.");
