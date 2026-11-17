// Design debt: which source files still use values outside design system v2.
//
//   npm run design:debt             print the totals and check design-debt.json
//   npm run design:debt -- --update rewrite design-debt.json from the code
//
// design-debt.json lists the files that are EXEMPT from the design lint rules
// (eslint.config.mjs) because they have not been migrated yet. The list may
// only shrink: this script fails if a file in it is already clean (remove it,
// so the rules start protecting it) and `--update` refuses to add files.

import fs from "node:fs";
import path from "node:path";
import { RULES } from "../design-rules.mjs";

const FILE = "design-debt.json";
const update = process.argv.includes("--update");
const init = process.argv.includes("--init");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const RAW_BUTTON = /<button\b/g;
const isPrimitive = (file) => /^src\/components\/(ds|ui)\//.test(file);

const totals = Object.fromEntries([...RULES.map((r) => [r.id, 0]), ["raw-button", 0]]);
const dirty = [];
for (const abs of walk("src")) {
  const file = abs.split(path.sep).join("/");
  const text = fs.readFileSync(abs, "utf8");
  let hits = 0;
  for (const rule of RULES) {
    const n = (text.match(new RegExp(rule.pattern, "g")) ?? []).length;
    totals[rule.id] += n;
    hits += n;
  }
  if (!isPrimitive(file)) {
    const n = (text.match(RAW_BUTTON) ?? []).length;
    totals["raw-button"] += n;
    hits += n;
  }
  if (hits) dirty.push(file);
}
dirty.sort();

const recorded = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")).files : [];

console.log("Off-system values left in src/:");
for (const [id, n] of Object.entries(totals)) console.log(`  ${String(n).padStart(5)}  ${id}`);
console.log(`  ${String(dirty.length).padStart(5)}  files`);

if (init || update) {
  const added = dirty.filter((f) => !recorded.includes(f));
  if (update && added.length) {
    console.error(`\nRefusing to add files to ${FILE} — these have new off-system values; fix them instead:\n  ${added.join("\n  ")}`);
    process.exit(1);
  }
  fs.writeFileSync(FILE, JSON.stringify({ files: dirty }, null, 2) + "\n");
  console.log(`\nWrote ${FILE}: ${dirty.length} files exempt (was ${recorded.length}).`);
  process.exit(0);
}

const clean = recorded.filter((f) => !dirty.includes(f));
if (clean.length) {
  console.error(`\nThese files are clean now but still exempt in ${FILE}. Run \`npm run design:debt -- --update\`:\n  ${clean.join("\n  ")}`);
  process.exit(1);
}
console.log(`\n${FILE}: ${recorded.length} files still exempt.`);
