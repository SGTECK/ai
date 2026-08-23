import { defineConfig, devices } from "@playwright/test";

/**
 * E2E for GCE-TLY AI Assistant.
 * This product has NO signup / login / payment / logout.
 * Mapped journeys: session start, chat core action, admin auth, clear session (new chat).
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT || 3000);
const BASE = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: process.env.CI ? "npm run start" : "npm run dev",
        url: BASE,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          FAQ_FAST_PATH: "1",
          FREE_MODE: "1",
          // Chat works without Ollama for FAQ path if knowledge loaded
          LLM_PROVIDER: process.env.LLM_PROVIDER || "ollama",
        },
      },
});
