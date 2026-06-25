#!/usr/bin/env node
/** Build bundled Capacitor index.html from the unified login shell (no PWA styles.css). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const src = path.join(repoRoot, "frontend", "native-app-login.html");
const dest = path.join(root, "www", "app", "index.html");

let html = fs.readFileSync(src, "utf8");
const dropPatterns = [
  /<link rel="canonical"[^>]*>\s*/i,
  /<script src="\.\/portal-sw-guard\.js[^"]*"><\/script>\s*/i,
  /<script src="\.\/app-host-guard\.js[^"]*"><\/script>\s*/i,
  /<script src="\.\/app-icons\.js[^"]*"><\/script>\s*/i,
  /<script src="\.\/cookie-consent\.js[^"]*"><\/script>\s*/i,
  /<link rel="stylesheet" href="\.\/styles\.css[^"]*" \/>\s*/i,
];

for (const pattern of dropPatterns) {
  html = html.replace(pattern, "");
}

html = html.replace(
  /<script src="\.\/brand-config\.js[^"]*"><\/script>\s*(?:<script src="\.\/app-host-guard\.js[^"]*"><\/script>\s*)?<script src="\.\/native-app\.js[^"]*"><\/script>\s*(?:<script src="\.\/session-auth\.js[^"]*"><\/script>\s*)?/i,
    `<link rel="stylesheet" href="./native-app-startup.css?v=4" />
    <script src="./native-app-startup.js?v=6"></script>
    <script src="./brand-config.js?v=brand-v8"></script>
    <script src="./native-app.js?v=14"></script>
    <script src="./session-auth.js?v=11"></script>`,
);

html = html.replace(
  /<link rel="stylesheet" href="\.\/native-app-startup\.css[^"]*" \/>\s*<script src="\.\/native-app-startup\.js[^"]*"><\/script>\s*/i,
  "",
);

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, html);
console.log(`wrote ${path.relative(root, dest)}`);
