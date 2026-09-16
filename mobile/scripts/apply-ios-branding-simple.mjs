#!/usr/bin/env node
/** Copy ShiftSwift branded icon + splash into the active ios-app Xcode asset catalogs. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const variant = process.env.SSHR_APP || "app";
const iosRoot = path.join(root, `ios-${variant === "app" ? "app" : variant}`, "App", "App");
const assetsDir = path.join(root, "assets");
const iconSrc = path.join(assetsDir, "icon.png");

const generated = spawnSync("node", ["scripts/generate-native-assets.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (generated.status !== 0) {
  process.exit(generated.status || 1);
}

if (!fs.existsSync(iconSrc)) {
  console.error(`Missing ${iconSrc}`);
  process.exit(1);
}

const iconDestDir = path.join(iosRoot, "Assets.xcassets", "AppIcon.appiconset");
const splashDestDir = path.join(iosRoot, "Assets.xcassets", "Splash.imageset");
const iconDest = path.join(iconDestDir, "AppIcon-512@2x.png");

fs.mkdirSync(iconDestDir, { recursive: true });
fs.mkdirSync(splashDestDir, { recursive: true });

const hasSips = spawnSync("sips", ["--help"], { stdio: "pipe" }).status === 0;

function runSips(args) {
  const result = spawnSync("sips", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`sips failed: ${args.join(" ")}`);
  }
}

/** App Store icons must be 1024×1024 PNG with no alpha channel. */
function writeOpaquePng(src, dest, size) {
  fs.copyFileSync(src, dest);
  if (!hasSips) {
    return;
  }
  runSips(["-z", String(size), String(size), dest]);
  const tmp = path.join(os.tmpdir(), `sshr-icon-${size}-${process.pid}.jpg`);
  try {
    runSips(["-s", "format", "jpeg", dest, "--out", tmp]);
    runSips(["-s", "format", "png", tmp, "--out", dest]);
    runSips(["-z", String(size), String(size), dest]);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

writeOpaquePng(iconSrc, iconDest, 1024);

/** Square app mark for launch screen — never stretch portrait splash art to a square. */
const splashFiles = [
  ["splash-2732x2732-2.png", 910],
  ["splash-2732x2732-1.png", 1821],
  ["splash-2732x2732.png", 2732],
];
for (const [name, size] of splashFiles) {
  const dest = path.join(splashDestDir, name);
  fs.copyFileSync(iconSrc, dest);
  if (hasSips) {
    runSips(["-z", String(size), String(size), dest]);
  }
}

const displayNames = {
  app: "ShiftSwift HR",
  employee: "Employee",
  business: "HR Admin",
};
const displayName = displayNames[variant] || "ShiftSwift HR";

const displayNamePlist = path.join(iosRoot, "Info.plist");
if (fs.existsSync(displayNamePlist)) {
  let plist = fs.readFileSync(displayNamePlist, "utf8");
  plist = plist.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${displayName}$2`,
  );
  fs.writeFileSync(displayNamePlist, plist);
}

console.log(`Branded icon and splash applied to ${path.relative(root, iosRoot)}`);
