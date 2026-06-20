#!/usr/bin/env node
/** Keep bundled Capacitor login assets in sync with frontend helpers. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const wwwApp = path.join(root, "www", "app");
const frontend = path.join(repoRoot, "frontend");

const copies = [
  "brand-config.js",
  "native-app.js",
  "native-app-chrome.css",
  "native-app-login.css",
  "native-app-bootstrap.js",
];

fs.mkdirSync(wwwApp, { recursive: true });
for (const file of copies) {
  const src = path.join(frontend, file);
  const dest = path.join(wwwApp, file);
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.relative(root, dest)}`);
}
