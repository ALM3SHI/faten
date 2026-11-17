// Gives the built service worker a version unique to this build, so every
// deploy installs a new worker: open tabs are told «يوجد تحديث» and the page
// cache starts fresh. Runs after `next build` (npm postbuild, e2e/build.mjs).
//   node scripts/stamp-sw.mjs [outDir]
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || "out";
const file = path.join(out, "push-sw.js");
const src = fs.readFileSync(file, "utf8");
const version = `b${Date.now().toString(36)}`;
const stamped = src.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
if (stamped === src) {
  console.error(`stamp-sw: no VERSION line in ${file}`);
  process.exit(1);
}
fs.writeFileSync(file, stamped);
console.log(`stamp-sw: ${file} → ${version}`);
