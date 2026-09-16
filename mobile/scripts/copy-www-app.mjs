#!/usr/bin/env node
/** Keep bundled Capacitor login + employee portal assets in sync with frontend. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const wwwApp = path.join(root, "www", "app");
const frontend = path.join(repoRoot, "frontend");

const copies = [
  "brand-config.js",
  "trusted-device.js",
  "passkey-auth.js",
  "session-auth.js",
  "auth-guard.js",
  "native-app.js",
  "native-app-chrome.css",
  "native-app-login.css",
  "native-app-startup.css",
  "native-app-startup.js",
  "native-app-bootstrap.js",
  "native-bundled-url.js",
  "native-app-portal-guard.js",
  "native-portal-fix.js",
  "native-api-fetch.js",
  "unified-login.js",
  "action-feedback.js",
  "native-geolocation.js",
  "native-shift-alerts.js",
  "employee-mobile-polish.css",
  "employee-mobile.js",
  "mobile-shell.js",
  "native-employee-portal.js",
  "native-touch-rescue.js",
  "employee-push-alerts.js",
  "push-notifications.js",
  "employee.js",
  "native-employee-boot.js",
  "native-unified-login-redirect.js",
  "app-icons.js",
  "portal-pwa-stability.js",
  "employee-pwa.js",
  "mobile-tables.js",
  "admin-icons.js",
  "employee-time-punch.js",
  "employee-timesheet.js",
  "employee-rota.js",
  "employee-shift-reminders.js",
  "employee-documents.js",
  "employee-notes.js",
  "employee-security.js",
  "employee-leave.js",
  "employee-my-details.js",
  "styles.css",
  "theme.css",
];

const assetCopies = ["assets/shiftswift-employee-app-icon-192.png", "assets/shiftswift-hr-app-icon-192.png"];

fs.mkdirSync(wwwApp, { recursive: true });
for (const file of copies) {
  const src = path.join(frontend, file);
  const dest = path.join(wwwApp, file);
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.relative(root, dest)}`);
}

for (const file of assetCopies) {
  const src = path.join(frontend, file);
  const dest = path.join(wwwApp, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.relative(root, dest)}`);
}

for (const script of ["sync-login-html.mjs", "sync-employee-html.mjs"]) {
  const sync = spawnSync("node", [`scripts/${script}`], {
    cwd: root,
    stdio: "inherit",
  });
  if (sync.status !== 0) {
    process.exit(sync.status ?? 1);
  }
}
