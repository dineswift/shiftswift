/**
 * Capture live admin console screens for the marketing homepage.
 * Requires local frontend (5173) + API (3000) and Playwright (e2e/).
 *
 *   cd e2e && npm install && npx playwright install chromium
 *   node scripts/capture_marketing_screenshots.mjs
 */
import { chromium } from "../e2e/node_modules/playwright/index.mjs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "frontend", "assets", "screenshots");
const API = process.env.SSHR_SHOT_API || "http://localhost:3000";
const BASE = process.env.SSHR_SHOT_BASE || "http://localhost:5173";
const HR_USER = process.env.E2E_HR_USER || "hr@shiftswifthr.co.uk";
const HR_PASSWORD = process.env.E2E_HR_PASSWORD || "ShiftswiftHR-Tenant-2026";

const SHOTS = [
  {
    slug: "admin-overview",
    hash: "#overview",
    wait: "#overview-metrics",
    ready: async (page) =>
      page.locator("#overview-metrics .hr-stat-card, #overview-modules .overview-module-card").first().waitFor({ timeout: 25_000 }),
  },
  {
    slug: "time-clock",
    hash: "#time-punch",
    wait: "#time-punch",
    ready: async (page) => page.locator("#time-punch .punch-desktop-chrome h2").waitFor({ timeout: 20_000 }),
  },
  {
    slug: "compliance",
    hash: "#compliance",
    wait: "#compliance",
    ready: async (page) => {
      await page.locator("#compliance header.section-header h2").waitFor({ timeout: 20_000 });
      const ackOrTools = page.locator(
        "#sponsor-licence-ack-panel:not([hidden]), #sponsor-enabled-banner:not([hidden]), #compliance-tools-content:not([hidden])"
      );
      await ackOrTools.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
      const ack = page.locator("#sponsor-licence-ack-panel");
      if (await ack.isVisible().catch(() => false)) {
        await page.locator("label.sponsor-ack-check").nth(0).click();
        await page.locator("label.sponsor-ack-check").nth(1).click();
        await page.locator("label.sponsor-ack-check").nth(2).click();
        await page.waitForTimeout(300);
        const enable = page.locator("#sponsor-licence-ack-btn");
        if (await enable.isEnabled().catch(() => false)) {
          await enable.click();
          await page
            .locator("#sponsor-enabled-banner:not([hidden]), #sponsor-duty-cards:not([hidden]), #compliance-tools-content:not([hidden])")
            .first()
            .waitFor({ state: "visible", timeout: 15_000 })
            .catch(() => {});
          await page.waitForTimeout(900);
        }
      }
    },
  },
];

async function loginViaApi() {
  for (const endpoint of ["/auth/unified-login", "/auth/business-login"]) {
    const res = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: HR_USER, password: HR_PASSWORD }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    if (data.access_token) return data;
  }
  throw new Error("HR login failed — start local API and check seed credentials.");
}

async function main() {
  const session = await loginViaApi();

  const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() =>
    chromium.launch({ headless: true })
  );
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (err) => console.warn("pageerror", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.warn("console", msg.text());
  });

  await page.addInitScript((data) => {
    localStorage.setItem("token", String(data.access_token || ""));
    if (data.refresh_token) localStorage.setItem("refreshToken", String(data.refresh_token));
    if (data.role) localStorage.setItem("userRole", String(data.role));
    if (data.tenant_id != null) {
      localStorage.setItem("tenantId", String(data.tenant_id));
      localStorage.setItem("masterTenantId", String(data.tenant_id));
    }
    localStorage.setItem("shiftswift_cookie_consent", JSON.stringify({ version: "1", level: "essential" }));
    localStorage.setItem("pwaInstallDismissed:admin", "1");
  }, session);

  for (const shot of SHOTS) {
    const url = `${BASE}/admin.html${shot.hash}`;
    console.log(`capturing ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    console.log("loaded", page.url());
    await page.waitForSelector(shot.wait, { state: "visible", timeout: 20_000 });
    try {
      await shot.ready(page);
    } catch (err) {
      const debug = path.join(OUT, `${shot.slug}-debug.png`);
      await page.screenshot({ path: debug, type: "png", fullPage: false });
      console.warn(`ready wait failed, wrote ${debug}`);
      throw err;
    }
    await page.addStyleTag({
      content: `
        #cookie-consent-banner { display: none !important; }
        body.cookie-consent-open { overflow: auto !important; }
        .portal-pwa-install-banner { display: none !important; }
      `,
    });
    await page.waitForTimeout(1400);
    const png = path.join(OUT, `${shot.slug}.png`);
    await page.screenshot({ path: png, type: "png", fullPage: false });
    console.log(`wrote ${png}`);
  }

  await browser.close();

  const convert = spawnSync("python3", ["-c", `
from pathlib import Path
from PIL import Image
out = Path(${JSON.stringify(OUT)})
for slug in ${JSON.stringify(SHOTS.map((s) => s.slug))}:
    png = out / f"{slug}.png"
    img = Image.open(png).convert("RGB")
    webp = out / f"{slug}.webp"
    img.save(webp, "WEBP", quality=86, method=6)
    print(f"wrote {webp.name} ({img.size[0]}x{img.size[1]})")
`], { cwd: ROOT, encoding: "utf8" });
  if (convert.status !== 0) {
    console.error(convert.stdout, convert.stderr);
    throw new Error("WebP conversion failed");
  }
  process.stdout.write(convert.stdout);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
