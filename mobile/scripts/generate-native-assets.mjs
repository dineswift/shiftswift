#!/usr/bin/env node
/** Copy branded ShiftSwift icon + splash for Capacitor iOS asset generation. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const assetsDir = path.join(root, "assets");
const frontendAssets = path.join(repoRoot, "frontend", "assets");

const branded = {
  icon: "shiftswift-hr-app-icon.png",
  splash: "shiftswift-unified-splash-1170x2532.png",
};

const legacyVariants = [
  { slug: "employee", icon: "shiftswift-employee-app-icon.png", splash: "shiftswift-employee-splash-1170x2532.png" },
  { slug: "business", icon: "shiftswift-hr-app-icon.png", splash: "shiftswift-hr-splash-1170x2532.png" },
];

fs.mkdirSync(assetsDir, { recursive: true });

function copyRequired(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Missing required asset: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`wrote ${path.relative(root, dest)}`);
}

function copyOptional(src, dest, fallback) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`wrote ${path.relative(root, dest)}`);
    return;
  }
  if (fallback && fs.existsSync(fallback)) {
    fs.copyFileSync(fallback, dest);
    console.log(`wrote ${path.relative(root, dest)} (fallback)`);
    return;
  }
  console.warn(`skip missing asset: ${src}`);
}

const iconSrc = path.join(frontendAssets, branded.icon);
const splashSrc = path.join(frontendAssets, branded.splash);
const iconDest = path.join(assetsDir, "icon.png");

copyRequired(iconSrc, iconDest);
copyOptional(splashSrc, path.join(assetsDir, "splash.png"), iconDest);
copyOptional(splashSrc, path.join(assetsDir, "splash-dark.png"), iconDest);

for (const variant of legacyVariants) {
  copyOptional(
    path.join(frontendAssets, variant.icon),
    path.join(assetsDir, `${variant.slug}-icon.png`),
    iconDest,
  );
  copyOptional(
    path.join(frontendAssets, variant.splash),
    path.join(assetsDir, `${variant.slug}-splash.png`),
    iconDest,
  );
}
