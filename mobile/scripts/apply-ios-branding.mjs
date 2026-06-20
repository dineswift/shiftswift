#!/usr/bin/env node
/** Apply branded icon + splash to the active Capacitor iOS Xcode project. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const variant = process.env.SSHR_APP || "app";

spawnSync("node", ["scripts/generate-native-assets.mjs"], {
  cwd: root,
  stdio: "inherit",
});

const result = spawnSync(
  "npx",
  ["@capacitor/assets", "generate", "--ios", "--assetPath", "assets", "--iosProject", `ios-${variant === "app" ? "app" : variant}/App`],
  { cwd: root, stdio: "inherit", env: { ...process.env, SSHR_APP: variant } },
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`Applied branded icon and splash to ios-${variant === "app" ? "app" : variant}`);
