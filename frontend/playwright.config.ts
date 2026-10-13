import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the main student journeys.
 *
 *   npm run build:e2e   # static build with fake Firebase → out-e2e/
 *   npm run test:e2e    # starts the mock API + static server, runs the specs
 *
 * No real Firebase project or backend is touched: e2e/fakes replaces the
 * Firebase SDK at build time and e2e/mock-server.mjs answers the API.
 */
const MOCK_PORT = 8787;
const WEB_PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `node e2e/mock-server.mjs`,
      url: `http://localhost:${MOCK_PORT}/health`,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `node e2e/static-server.mjs out-e2e ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
