#!/usr/bin/env node
/** Keep bundled Capacitor login assets in sync with frontend helpers. */
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
  "session-auth.js",
  "auth-guard.js",
  "native-app.js",
  "native-app-chrome.css",
  "native-app-login.css",
  "native-app-startup.css",
  "native-app-startup.js",
  "native-app-bootstrap.js",
  "native-app-portal-guard.js",
  "native-portal-fix.js",
  "native-api-fetch.js",
  "unified-login.js",
];

fs.mkdirSync(wwwApp, { recursive: true });
for (const file of copies) {
  const src = path.join(frontend, file);
  const dest = path.join(wwwApp, file);
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.relative(root, dest)}`);
}

const syncLogin = spawnSync("node", ["scripts/sync-login-html.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (syncLogin.status !== 0) {
  process.exit(syncLogin.status ?? 1);
}
