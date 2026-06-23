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

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Missing asset: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`wrote ${path.relative(root, dest)}`);
}

const iconSrc = path.join(frontendAssets, branded.icon);
const splashSrc = path.join(frontendAssets, branded.splash);

copyIfExists(iconSrc, path.join(assetsDir, "icon.png"));
copyIfExists(splashSrc, path.join(assetsDir, "splash.png"));
copyIfExists(splashSrc, path.join(assetsDir, "splash-dark.png"));

for (const variant of legacyVariants) {
  copyIfExists(
    path.join(frontendAssets, variant.icon),
    path.join(assetsDir, `${variant.slug}-icon.png`),
  );
  const variantSplash = path.join(frontendAssets, variant.splash);
  if (fs.existsSync(variantSplash)) {
    copyIfExists(variantSplash, path.join(assetsDir, `${variant.slug}-splash.png`));
  }
}
