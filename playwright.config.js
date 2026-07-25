import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT) || 4187;
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;
const deployedJourneys = process.env.E2E_DEPLOYED === "true";

export default defineConfig({
  testDir: "./e2e",
  // Deployed journeys require intentionally provisioned disposable QA users.
  // Keep them out of the hermetic local suite unless explicitly requested.
  testIgnore: deployedJourneys ? [] : ["**/deployed-journeys.spec.js"],
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // The suite intentionally exercises one-time first-admin setup against one
  // isolated database. Retrying against that mutated database would be invalid.
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    // The Ori launcher intentionally floats forever. Respecting reduced motion
    // makes actionability checks deterministic while also exercising the app's
    // accessibility path.
    reducedMotion: "reduce",
    trace: deployedJourneys ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node scripts/start-e2e-server.mjs",
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 30_000,
        stdout: "pipe",
        stderr: "pipe",
        env: { E2E_PORT: String(port) },
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], reducedMotion: "reduce" },
    },
  ],
});
