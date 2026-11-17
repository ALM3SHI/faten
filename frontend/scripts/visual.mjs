// Runs e2e/visual.spec.ts (see the notes there).
//   npm run visual:baseline   record reference screenshots for the current code
//   npm run visual:check      compare the current code against them
import { spawnSync } from "node:child_process";

const args = ["playwright", "test", "e2e/visual.spec.ts"];
if (process.argv.includes("--update")) args.push("--update-snapshots");
const run = spawnSync("npx", args, {
  stdio: "inherit",
  env: { ...process.env, VISUAL: "1" },
  shell: process.platform === "win32",
});
process.exit(run.status ?? 1);
