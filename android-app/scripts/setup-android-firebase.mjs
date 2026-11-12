#!/usr/bin/env node
/** Install Firebase google-services.json for Android FCM push. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "android", "app", "google-services.json");
const src = process.argv[2] || process.env.GOOGLE_SERVICES_JSON;

if (!src) {
  console.error(`Usage: node scripts/setup-android-firebase.mjs /path/to/google-services.json
Or:  export GOOGLE_SERVICES_JSON=/path/to/google-services.json && node scripts/setup-android-firebase.mjs`);
  process.exit(1);
}

if (!fs.existsSync(src)) {
  console.error(`File not found: ${src}`);
  process.exit(1);
}

const json = JSON.parse(fs.readFileSync(src, "utf8"));
const packageName = json?.client?.[0]?.client_info?.android_client_info?.package_name;
if (packageName && packageName !== "co.uk.shiftswifthr.app") {
  console.error(`google-services.json package is ${packageName}, expected co.uk.shiftswifthr.app`);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(`Installed ${path.relative(root, dest)}`);
console.log("Run: npm run sync:android");
