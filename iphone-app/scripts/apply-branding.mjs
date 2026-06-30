#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const iosRoot = path.join(root, "ios", "App", "App");
const assetsDir = path.join(repoRoot, "mobile", "assets");
const iconSrc = path.join(assetsDir, "icon.png");

if (!fs.existsSync(iconSrc)) {
  spawnSync("node", ["scripts/generate-native-assets.mjs"], { cwd: path.join(repoRoot, "mobile"), stdio: "inherit" });
}

const iconDestDir = path.join(iosRoot, "Assets.xcassets", "AppIcon.appiconset");
const splashDestDir = path.join(iosRoot, "Assets.xcassets", "Splash.imageset");
const iconDest = path.join(iconDestDir, "AppIcon-512@2x.png");

fs.mkdirSync(iconDestDir, { recursive: true });
fs.mkdirSync(splashDestDir, { recursive: true });

function runSips(args) {
  const result = spawnSync("sips", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`sips failed: ${args.join(" ")}`);
}

fs.copyFileSync(iconSrc, iconDest);
runSips(["-z", "1024", "1024", iconDest]);

for (const [name, size] of [
  ["splash-2732x2732-2.png", 910],
  ["splash-2732x2732-1.png", 1821],
  ["splash-2732x2732.png", 2732],
]) {
  const dest = path.join(splashDestDir, name);
  fs.copyFileSync(iconSrc, dest);
  runSips(["-z", String(size), String(size), dest]);
}

const plistPath = path.join(iosRoot, "Info.plist");
if (fs.existsSync(plistPath)) {
  let plist = fs.readFileSync(plistPath, "utf8");
  plist = plist.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    "$1ShiftSwift HR$2",
  );
  fs.writeFileSync(plistPath, plist);
}

console.log(`Branding applied to ${path.relative(root, iosRoot)}`);
