#!/usr/bin/env node
/** Copy ShiftSwift branded icon + splash into the active ios-app Xcode asset catalogs. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const variant = process.env.SSHR_APP || "app";
const iosRoot = path.join(root, `ios-${variant === "app" ? "app" : variant}`, "App", "App");
const assetsDir = path.join(root, "assets");
const iconSrc = path.join(assetsDir, "icon.png");

spawnSync("node", ["scripts/generate-native-assets.mjs"], { cwd: root, stdio: "inherit" });

const iconDestDir = path.join(iosRoot, "Assets.xcassets", "AppIcon.appiconset");
const splashDestDir = path.join(iosRoot, "Assets.xcassets", "Splash.imageset");
const iconDest = path.join(iconDestDir, "AppIcon-512@2x.png");

fs.mkdirSync(iconDestDir, { recursive: true });
fs.mkdirSync(splashDestDir, { recursive: true });

function hasSips() {
  const result = spawnSync("sips", ["--help"], { stdio: "ignore" });
  return result.status === 0 || result.status === 1 || result.status === 2;
}

function runSips(args) {
  const result = spawnSync("sips", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`sips failed: ${args.join(" ")}`);
  }
}

fs.copyFileSync(iconSrc, iconDest);

/** Square app mark for launch screen — never stretch portrait splash art to a square. */
const splashFiles = [
  ["splash-2732x2732-2.png", 910],
  ["splash-2732x2732-1.png", 1821],
  ["splash-2732x2732.png", 2732],
];

if (!hasSips()) {
  console.warn("sips not available (macOS only) — copied icons without resize; run brand:ios on a Mac before Archive.");
  for (const [name] of splashFiles) {
    fs.copyFileSync(iconSrc, path.join(splashDestDir, name));
  }
} else {
  runSips(["-z", "1024", "1024", iconDest]);
  for (const [name, size] of splashFiles) {
    const dest = path.join(splashDestDir, name);
    fs.copyFileSync(iconSrc, dest);
    runSips(["-z", String(size), String(size), dest]);
  }
}

const displayNamePlist = path.join(iosRoot, "Info.plist");
if (fs.existsSync(displayNamePlist)) {
  let plist = fs.readFileSync(displayNamePlist, "utf8");
  plist = plist.replace(
    /<string>App<\/string>/,
    "<string>ShiftSwift HR</string>",
  );
  if (!plist.includes("ShiftSwift HR")) {
    plist = plist.replace(
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
      "$1ShiftSwift HR$2",
    );
  }
  fs.writeFileSync(displayNamePlist, plist);
}

console.log(`Branded icon and splash applied to ${path.relative(root, iosRoot)}`);
