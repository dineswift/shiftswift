#!/usr/bin/env bash
# Build and install ShiftSwift HR on a connected Android phone/tablet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
BUNDLE_ID="co.uk.shiftswifthr.app"
DEVICE_ID="${1:-}"

java_major() {
  local home="${1:-}"
  [[ -n "$home" && -x "$home/bin/java" ]] || return 1
  "$home/bin/java" -version 2>&1 | awk -F[\".] '/version/ { print $2; exit }'
}

resolve_java_home() {
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
  echo "JDK 21 is required for Capacitor 7 Android builds."
  echo "Install JDK 21, or run: cd android && ./gradlew assembleDebug (Gradle will download a toolchain)."
  exit 1
}

resolve_java_home
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

cd "$ROOT"
node scripts/sync-www.mjs
# Guard PushNotifications against missing Firebase (same crash fix as Play archive)
node scripts/patch-push-firebase-guard.mjs
npx cap sync android
# cap sync can refresh plugin sources — re-apply after sync
node scripts/patch-push-firebase-guard.mjs
node scripts/apply-android-branding.mjs

# macOS sometimes duplicates res files ("config 2.xml") which breaks Gradle.
find "$ROOT/android/app/src/main/res" -name '* *' -delete 2>/dev/null || true

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(adb devices | awk 'NR>1 && $2=="device" { print $1; exit }')"
fi

# Prefer a single online emulator/device when several are listed
if [[ -z "$DEVICE_ID" ]]; then
  echo "No connected Android device found. Enable USB debugging and trust this computer."
  exit 1
fi

# Clear macOS duplicate resource names again after branding (Finder copies)
find "$ROOT/android/app/src/main/res" -name '* *' -delete 2>/dev/null || true

echo "==> Building debug APK"
cd "$ANDROID"
./gradlew assembleDebug

APK="$ANDROID/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK" ]]; then
  echo "Build output missing: $APK"
  exit 1
fi

echo "==> Installing on device $DEVICE_ID"
adb -s "$DEVICE_ID" install -r "$APK"

echo "==> Launching app"
adb -s "$DEVICE_ID" shell am start -n "$BUNDLE_ID/.MainActivity"

echo "Installed ShiftSwift HR on device $DEVICE_ID"
