#!/usr/bin/env bash
# Build a signed Play Store AAB for ShiftSwift HR.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
AAB="$ANDROID/app/build/outputs/bundle/release/app-release.aab"
KEY_PROPS="$ANDROID/key.properties"

java_major() {
  local home="${1:-}"
  [[ -n "$home" && -x "$home/bin/java" ]] || return 1
  "$home/bin/java" -version 2>&1 | awk -F[\".] '/version/ { print $2; exit }'
}

resolve_java_home() {
  # Prefer a real JDK 21 — stale JAVA_HOME=17 breaks Capacitor 7 ("invalid source release: 21").
  if [[ "$(java_major "${JAVA_HOME:-}")" == "21" ]]; then
    return
  fi
  if /usr/libexec/java_home -v 21 >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
    if [[ "$(java_major "$JAVA_HOME")" == "21" ]]; then
      return
    fi
  fi
  local gradle_jdk=""
  while IFS= read -r candidate; do
    if [[ "$(java_major "$candidate")" == "21" ]]; then
      gradle_jdk="$candidate"
      break
    fi
  done < <(find "$HOME/.gradle/jdks" -path "*/Contents/Home" -type d 2>/dev/null | sort -r)
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

echo "==> Guard PushNotifications against missing Firebase (crash fix)"
node scripts/patch-push-firebase-guard.mjs

echo "==> Sync Capacitor Android plugins (with timeout fallback)"
if ! npx --yes cap sync android; then
  echo "cap sync failed — copying www assets manually"
  mkdir -p android/app/src/main/assets/public
  rsync -a --delete www/ android/app/src/main/assets/public/
fi

# cap sync can refresh plugin sources from node_modules — re-apply guard after sync
node scripts/patch-push-firebase-guard.mjs

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
  VERSION_CODE="$(awk '/versionCode/ { print $2; exit }' "$ANDROID/app/build.gradle")"
  VERSION_NAME="$(awk -F'"' '/versionName/ { print $2; exit }' "$ANDROID/app/build.gradle")"
  NAMED="$ANDROID/app/build/outputs/bundle/release/ShiftSwiftHR-${VERSION_NAME}-${VERSION_CODE}.aab"
  cp -f "$AAB" "$NAMED"
  echo ""
  echo "AAB ready: $NAMED ($(du -h "$NAMED" | cut -f1))"
  echo "Package: co.uk.shiftswifthr.app  ·  $VERSION_NAME ($VERSION_CODE)"
  echo "Upload: npm run playstore:upload   (or Play Console → Create release)"
else
  echo "Build finished — check $ANDROID/app/build/outputs/bundle/release/"
  ls -la "$ANDROID/app/build/outputs/bundle/release/" 2>/dev/null || true
  exit 1
fi
