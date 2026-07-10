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

echo "==> Sync bundled www + Capacitor Android"
cd "$ROOT"
node scripts/sync-www.mjs
npx cap sync android
node scripts/apply-android-branding.mjs

if [[ ! -f "$KEY_PROPS" ]]; then
  echo ""
  echo "Release signing not configured ($KEY_PROPS missing)."
  echo "Run: bash scripts/setup-android-signing.sh"
  echo "Or copy android/key.properties.example → android/key.properties"
  exit 1
fi

if [[ ! -f "$ROOT/android/app/google-services.json" ]]; then
  echo ""
  echo "Warning: android/app/google-services.json not found — remote push will not work until Firebase is configured."
  echo "Run: node scripts/setup-android-firebase.mjs /path/to/google-services.json"
fi

echo "==> Build release AAB"
cd "$ANDROID"
./gradlew bundleRelease

if [[ -f "$AAB" ]]; then
  echo ""
  echo "AAB ready: $AAB ($(du -h "$AAB" | cut -f1))"
  echo "Upload with: npm run playstore:upload"
else
  echo "Build finished — check $ANDROID/app/build/outputs/bundle/release/"
  ls -la "$ANDROID/app/build/outputs/bundle/release/" 2>/dev/null || true
  exit 1
fi
