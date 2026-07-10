#!/usr/bin/env bash
# Fix corrupted CocoaPods (e.g. empty IONGeolocationLib.xcframework after interrupted install).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_APP="$ROOT/ios/App"

cd "$IOS_APP"

echo "==> Cleaning IONGeolocationLib pod cache"
pod cache clean IONGeolocationLib --all 2>/dev/null || true

echo "==> Removing Pods + Podfile.lock"
rm -rf Pods Podfile.lock

echo "==> Fresh pod install"
pod install --repo-update

echo "==> Capacitor iOS sync"
cd "$ROOT"
npx cap sync ios

echo "iOS pods repaired. Open with: npm run ios:open"
