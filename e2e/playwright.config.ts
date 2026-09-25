import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const apiURL = process.env.E2E_API_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: "bash scripts/start_local.sh",
        cwd: "..",
        url: `${baseURL}/sign-in.html`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          ...process.env,
          CI_E2E: "1",
          USE_DB: "0",
          APP_ENV: "development",
          DATABASE_URL: "",
          DEV_TENANT_USERNAME: process.env.E2E_HR_USER || "hr@shiftswifthr.co.uk",
          DEV_TENANT_PASSWORD: process.env.E2E_HR_PASSWORD || "ShiftswiftHR-Tenant-2026",
        },
      },
});
