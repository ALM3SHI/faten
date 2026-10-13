// Builds the static site for the Playwright suite (cross-platform env vars):
// Firebase is swapped for the fakes in e2e/fakes and the API points at the
// mock server. Output goes to out-e2e/, never to out/.
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  FATEN_E2E: "1",
  NEXT_PUBLIC_AGENT_BASE_URL: `http://localhost:${process.env.MOCK_PORT || 8787}`,
  NEXT_TELEMETRY_DISABLED: "1",
};
const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
