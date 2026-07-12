#!/usr/bin/env bash
# Build a signed Play Store AAB for ShiftSwift HR.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
AAB="$ANDROID/app/build/outputs/bundle/release/app-release.aab"
KEY_PROPS="$ANDROID/key.properties"

resolve_java_home() {
  if [[ -n "${JAVA_HOME:-}" ]]; then
    return
  fi
  if /usr/libexec/java_home -v 21 >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
    return
  fi
  local gradle_jdk=""
  gradle_jdk="$(find "$HOME/.gradle/jdks" -path "*/Contents/Home" -type d 2>/dev/null | head -1 || true)"
  if [[ -n "$gradle_jdk" ]]; then
    export JAVA_HOME="$gradle_jdk"
    return
  fi
  echo "JDK 21 is required. Install JDK 21 or run a debug build once so Gradle downloads a toolchain."
  exit 1
}

resolve_java_home
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

echo "==> Sync bundled www"
cd "$ROOT"
node scripts/sync-www.mjs

echo "==> Sync Capacitor Android plugins (with timeout fallback)"
if ! npx --yes cap sync android; then
  echo "cap sync failed — copying www assets manually"
  mkdir -p android/app/src/main/assets/public
  rsync -a --delete www/ android/app/src/main/assets/public/
fi

node scripts/apply-android-branding.mjs
# macOS Finder/iCloud duplicates break the Android asset merger
find "$ANDROID/app/src/main/res" -name '* *' -delete 2>/dev/null || true
find "$ANDROID/app/src/main/assets" -name '* *' -delete 2>/dev/null || true
# Drop empty leftover dirs from deleted "assets N" copies
find "$ANDROID/app/src/main/assets" -type d -empty -delete 2>/dev/null || true

if [[ ! -f "$KEY_PROPS" ]]; then
  echo ""
  echo "Release signing not configured ($KEY_PROPS missing)."
  echo "Run: npm run playstore:signing"
  echo "Or set env vars and run: bash scripts/setup-android-signing.sh --non-interactive"
  exit 1
fi

if [[ ! -f "$ROOT/android/app/google-services.json" ]]; then
  echo ""
  echo "Warning: android/app/google-services.json not found — remote FCM push will not work."
  echo "Run: npm run playstore:firebase -- /path/to/google-services.json"
  echo "Continuing AAB build without Firebase…"
fi

echo "==> Build release AAB (version from app/build.gradle)"
cd "$ANDROID"
./gradlew bundleRelease

if [[ -f "$AAB" ]]; then
  echo ""
  echo "AAB ready: $AAB ($(du -h "$AAB" | cut -f1))"
  echo "Package: co.uk.shiftswifthr.app"
  echo "Upload: npm run playstore:upload   (or Play Console → Create release)"
else
  echo "Build finished — check $ANDROID/app/build/outputs/bundle/release/"
  ls -la "$ANDROID/app/build/outputs/bundle/release/" 2>/dev/null || true
  exit 1
fi
