#!/usr/bin/env node
/** Bundle ShiftSwift frontend into the Capacitor iOS app (local files, not remote PWA). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const wwwApp = path.join(root, "www", "app");
const frontend = path.join(repoRoot, "frontend");

const skipDirs = new Set(["docs"]);
const skipFiles = new Set([
  "index.html",
  "landing.html",
  "app-root-index.html",
  "admin-sw.js",
  "employee-sw.js",
  "app-sw.js",
]);
const skipPrefixes = ["landing-"];
const allowedExt = new Set([
  ".html",
  ".js",
  ".css",
  ".png",
  ".svg",
  ".jpg",
  ".jpeg",
  ".webp",
  ".json",
  ".webmanifest",
  ".woff",
  ".woff2",
]);

function shouldSkipFile(name) {
  if (skipFiles.has(name)) return true;
  if (skipPrefixes.some((prefix) => name.startsWith(prefix))) return true;
  return false;
}

function copyTree(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      copyTree(src, dest);
      continue;
    }
    if (shouldSkipFile(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!allowedExt.has(ext)) continue;
    fs.copyFileSync(src, dest);
    console.log(`copied ${path.relative(root, dest)}`);
  }
}

copyTree(frontend, wwwApp);

for (const [folder, file] of [
  ["employee", "employee-login.html"],
  ["business", "business-login.html"],
]) {
  const destDir = path.join(root, "www", folder);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(frontend, file), path.join(destDir, file));
  console.log(`copied www/${folder}/${file}`);
}

const syncLogin = spawnSync("node", ["scripts/sync-login-html.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (syncLogin.status !== 0) {
  process.exit(syncLogin.status ?? 1);
}

const publicDir = path.join(root, "ios-app", "App", "App", "public");
if (fs.existsSync(path.dirname(publicDir))) {
  fs.cpSync(wwwApp, publicDir, { recursive: true });
  console.log(`copied ${path.relative(root, publicDir)}`);
}
