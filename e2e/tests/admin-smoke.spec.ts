import { expect, test } from "@playwright/test";

const HR_USER = process.env.E2E_HR_USER || "hr@shiftswifthr.co.uk";
const HR_PASSWORD = process.env.E2E_HR_PASSWORD || "ShiftswiftHR-Tenant-2026";
const API_BASE = process.env.E2E_API_URL || "http://127.0.0.1:3000";

async function dismissCookieBanner(page: import("@playwright/test").Page) {
  const accept = page.getByRole("button", { name: /Accept all|Essential only/i });
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
  }
}

async function seedHrSession(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  const res = await request.post(`${API_BASE}/auth/business-login`, {
    headers: { "Content-Type": "application/json" },
    data: { username: HR_USER, password: HR_PASSWORD },
  });
  expect(res.ok(), `HR login API failed (${res.status()}) — check dev seed / credentials`).toBeTruthy();
  const data = await res.json();
  await page.goto("/admin.html");
  await page.evaluate((session) => {
    if (session.access_token) localStorage.setItem("token", session.access_token);
    if (session.refresh_token) localStorage.setItem("refreshToken", session.refresh_token);
    if (session.role) localStorage.setItem("userRole", session.role);
    if (session.tenant_id != null) {
      localStorage.setItem("tenantId", String(session.tenant_id));
      localStorage.setItem("masterTenantId", String(session.tenant_id));
    }
  }, data);
  await page.reload();
  await dismissCookieBanner(page);
}

test.beforeAll(async ({ request }) => {
  let lastError = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const health = await request.get(`${API_BASE}/health`, { timeout: 5_000 });
      expect(health.ok(), `API not reachable at ${API_BASE}/health`).toBeTruthy();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`API not reachable at ${API_BASE}/health — ${lastError}`);
});

async function prepareLoginPage(page: import("@playwright/test").Page) {
  await page.goto("/business-login.html");
  await page.evaluate((apiUrl) => {
    if (window.ShiftSwiftBrand?.urls && apiUrl) {
      window.ShiftSwiftBrand.urls.localApi = apiUrl;
    }
  }, API_BASE);
}

test.describe("HR admin smoke", () => {
  test("business login form reaches admin overview", async ({ page }) => {
    await prepareLoginPage(page);
    await dismissCookieBanner(page);
    await page.locator('input[name="username"]').fill(HR_USER);
    await page.locator('input[name="password"]').fill(HR_PASSWORD);
    await page.locator("#login-submit").click();
    await page.waitForURL(/admin\.html/, { timeout: 45_000 });
    await expect(page.locator("#overview")).toBeVisible();
  });

  test("employees section opens from hash navigation", async ({ page, request }) => {
    await seedHrSession(page, request);
    await page.goto("/admin.html#employees");
    await expect(page.locator("#employees")).toBeVisible();
  });

  test("settings document store panel is reachable", async ({ page, request }) => {
    await seedHrSession(page, request);
    await page.goto("/admin.html#settings/documents");
    await expect(page.locator('[data-settings-panel="documents"]')).toBeVisible();
    await expect(page.locator("#document-upload-form")).toBeVisible();
    await expect(page.locator('[data-doc-tab="upload"]')).toBeVisible();
  });
});
