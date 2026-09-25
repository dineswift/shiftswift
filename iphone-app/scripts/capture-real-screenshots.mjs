/**
 * Capture real ShiftSwift HR UI screenshots at App Store sizes.
 * Uses the same bundled www assets as the iPhone app.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "app-store-screenshots");
const BASE = process.env.SSHR_SHOT_BASE || "http://127.0.0.1:8765";

// Logical iPhone viewport (CSS pixels). We scale up to App Store pixel sizes.
const VIEWPORT = { width: 430, height: 932, deviceScaleFactor: 3 };

const SIZES = {
  "6.9": { width: 1320, height: 2868 },
  "6.1": { width: 1179, height: 2556 },
};

const PAGES = [
  { slug: "01-sign-in", path: "/index.html", wait: 800 },
  { slug: "02-employee-login", path: "/employee-login.html?source=native", wait: 800 },
  { slug: "03-business-login", path: "/business-login.html?source=native", wait: 800 },
  { slug: "04-unified-sign-in", path: "/sign-in.html?source=native", wait: 800 },
];

async function resizeTo(pngBuffer, targetW, targetH) {
  // Use Playwright's built-in screenshot at exact size via a second page canvas approach:
  // simpler: launch with deviceScaleFactor so 430*3=1290, then pad/crop with sharp if available.
  // Fallback: write as-is and use sips on macOS.
  return pngBuffer;
}

async function main() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  const rawDir = path.join(OUT, "raw");
  await mkdir(rawDir, { recursive: true });

  for (const item of PAGES) {
    const url = `${BASE}${item.path}`;
    console.log(`capturing ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(item.wait);
    // Hide any desktop-only chrome if present
    await page.addStyleTag({
      content: `
        html, body { overflow: hidden !important; }
        * { -webkit-font-smoothing: antialiased; }
      `,
    });
    const file = path.join(rawDir, `${item.slug}.png`);
    await page.screenshot({ path: file, fullPage: false, type: "png" });
    console.log(`wrote ${file}`);
  }

  await browser.close();
  console.log("\nRaw captures done. Run resize step with sips.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
