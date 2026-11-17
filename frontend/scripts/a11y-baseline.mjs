// Re-records e2e/a11y-baseline.json from a full axe run and prints a summary.
//
//   npm run a11y:baseline
//
// Run it only after FIXING violations: the baseline is a ratchet that should
// only ever shrink (see e2e/a11y.spec.ts).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PARTS = "test-results/a11y-parts";
const OUT = "e2e/a11y-baseline.json";

fs.rmSync(PARTS, { recursive: true, force: true });
const run = spawnSync("npx", ["playwright", "test", "e2e/a11y.spec.ts"], {
  stdio: "inherit",
  env: { ...process.env, A11Y_UPDATE: "1" },
  shell: process.platform === "win32",
});
if (run.status !== 0) process.exit(run.status ?? 1);

const baseline = {};
for (const file of fs.readdirSync(PARTS).sort()) {
  const { key, found } = JSON.parse(fs.readFileSync(path.join(PARTS, file), "utf8"));
  if (Object.keys(found).length) baseline[key] = Object.fromEntries(Object.entries(found).sort());
}
const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n");

const byRule = {};
for (const counts of Object.values(sorted)) for (const [rule, n] of Object.entries(counts)) byRule[rule] = (byRule[rule] ?? 0) + n;
console.log(`\n${OUT}: ${Object.keys(sorted).length} page variants with violations`);
for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${rule}`);
