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

async function applyLocalApi(page: import("@playwright/test").Page) {
  await page.evaluate((apiUrl) => {
    if (window.ShiftSwiftBrand?.urls && apiUrl) {
      window.ShiftSwiftBrand.urls.localApi = apiUrl;
    }
    localStorage.removeItem("apiBaseUrl");
    const passkey = document.getElementById("login-use-passkey");
    if (passkey instanceof HTMLInputElement) passkey.checked = false;
  }, API_BASE);
}

async function storeSession(page: import("@playwright/test").Page, session: Record<string, unknown>) {
  await page.evaluate((data) => {
    if (data.access_token) localStorage.setItem("token", String(data.access_token));
    if (data.refresh_token) localStorage.setItem("refreshToken", String(data.refresh_token));
    if (data.role) localStorage.setItem("userRole", String(data.role));
    if (data.tenant_id != null) {
      localStorage.setItem("tenantId", String(data.tenant_id));
      localStorage.setItem("masterTenantId", String(data.tenant_id));
    }
  }, session);
}

async function loginViaApi(request: import("@playwright/test").APIRequestContext) {
  const endpoints = ["/auth/unified-login", "/auth/business-login"];
  let lastStatus = 0;
  let lastBody = "";

  for (const endpoint of endpoints) {
    const res = await request.post(`${API_BASE}${endpoint}`, {
      headers: { "Content-Type": "application/json" },
      data: { username: HR_USER, password: HR_PASSWORD },
    });
    lastStatus = res.status();
    lastBody = await res.text();
    if (!res.ok()) continue;
    const data = JSON.parse(lastBody) as Record<string, unknown>;
    if (data.access_token) return data;
  }

  throw new Error(`HR login API failed (${lastStatus}) — ${lastBody || "check dev seed / credentials"}`);
}

async function seedHrSession(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  const data = await loginViaApi(request);
  await page.goto("/admin.html");
  await storeSession(page, data);
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

async function prepareSignInPage(page: import("@playwright/test").Page) {
  await page.goto("/sign-in.html");
  await page.waitForURL(/sign-in\.html/, { timeout: 15_000 });
  await page.waitForSelector("#portal-login-form", { state: "visible" });
  await applyLocalApi(page);
}

test.describe("HR admin smoke", () => {
  test("unified sign-in reaches admin overview", async ({ page }) => {
    await prepareSignInPage(page);
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
