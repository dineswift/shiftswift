#!/usr/bin/env node
/** Apply ShiftSwift HR branding to the Capacitor Android project. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const androidRoot = path.join(root, "android");
const assetsDir = path.join(repoRoot, "mobile", "assets");
const iconSrc = path.join(assetsDir, "icon.png");
const splashSrc = path.join(assetsDir, "splash.png");

if (!fs.existsSync(androidRoot)) {
  console.error("Android project not found. Run: npx cap add android");
  process.exit(1);
}

if (!fs.existsSync(iconSrc)) {
  spawnSync("node", ["scripts/generate-native-assets.mjs"], {
    cwd: path.join(repoRoot, "mobile"),
    stdio: "inherit",
  });
}

function runSips(args) {
  const result = spawnSync("sips", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`sips failed: ${args.join(" ")}`);
}

function ensurePng(src, dest, size) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  runSips(["-z", String(size), String(size), dest]);
}

const resRoot = path.join(androidRoot, "app", "src", "main", "res");

// Launcher icons (mipmap)
const launcherSizes = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

for (const [folder, size] of Object.entries(launcherSizes)) {
  const dir = path.join(resRoot, folder);
  ensurePng(iconSrc, path.join(dir, "ic_launcher.png"), size);
  ensurePng(iconSrc, path.join(dir, "ic_launcher_round.png"), size);
  ensurePng(iconSrc, path.join(dir, "ic_launcher_foreground.png"), size);
}

// Adaptive icon background colour
const valuesDir = path.join(resRoot, "values");
fs.mkdirSync(valuesDir, { recursive: true });
const colorsPath = path.join(valuesDir, "colors.xml");
const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#0f6e56</color>
    <color name="colorPrimaryDark">#0f6e56</color>
    <color name="colorAccent">#5DCAA5</color>
    <color name="ic_launcher_background">#0f6e56</color>
    <color name="splash_background">#0f6e56</color>
</resources>
`;
fs.writeFileSync(colorsPath, colorsXml);

// Remove template duplicate if present (branding defines ic_launcher_background in colors.xml)
const launcherBgPath = path.join(valuesDir, "ic_launcher_background.xml");
if (fs.existsSync(launcherBgPath)) {
  fs.unlinkSync(launcherBgPath);
}

// Splash drawable
const drawableDir = path.join(resRoot, "drawable");
fs.mkdirSync(drawableDir, { recursive: true });
const splashDrawable = path.join(drawableDir, "splash.png");
const splashSource = fs.existsSync(splashSrc) ? splashSrc : iconSrc;
ensurePng(splashSource, splashDrawable, 512);

// Splash screen theme (Android 12+)
const splashStylesPath = path.join(valuesDir, "styles.xml");
let stylesXml = "";
if (fs.existsSync(splashStylesPath)) {
  stylesXml = fs.readFileSync(splashStylesPath, "utf8");
  if (!stylesXml.includes("Theme.App.SplashScreen")) {
    stylesXml = stylesXml.replace(
      "</resources>",
      `    <style name="Theme.App.SplashScreen" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/splash_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash</item>
        <item name="postSplashScreenTheme">@style/AppTheme</item>
    </style>
</resources>`,
    );
  }
} else {
  stylesXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>
    <style name="Theme.App.SplashScreen" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/splash_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash</item>
        <item name="postSplashScreenTheme">@style/AppTheme</item>
    </style>
</resources>
`;
}
fs.writeFileSync(splashStylesPath, stylesXml);

// App display name in strings.xml
const stringsPath = path.join(valuesDir, "strings.xml");
let stringsXml = fs.existsSync(stringsPath) ? fs.readFileSync(stringsPath, "utf8") : "";
if (stringsXml.includes("<string name=\"app_name\">")) {
  stringsXml = stringsXml.replace(
    /<string name="app_name">[^<]*<\/string>/,
    "<string name=\"app_name\">ShiftSwift HR</string>",
  );
} else {
  stringsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">ShiftSwift HR</string>
    <string name="title_activity_main">ShiftSwift HR</string>
    <string name="package_name">co.uk.shiftswifthr.app</string>
    <string name="custom_url_scheme">co.uk.shiftswifthr.app</string>
</resources>
`;
}
fs.writeFileSync(stringsPath, stringsXml);

console.log(`Branding applied to ${path.relative(root, androidRoot)}`);
