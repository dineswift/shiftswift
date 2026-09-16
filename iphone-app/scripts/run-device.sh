#!/usr/bin/env bash
# Install ShiftSwift HR on a connected physical iPad/iPhone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/ios/App"
DERIVED="$ROOT/ios/build/DeviceDerivedData"
BUNDLE_ID="co.uk.shiftswifthr.app"
DEVICE_ID="${1:-}"

cd "$ROOT"
node scripts/sync-www.mjs
rsync -a www/ "$IOS/App/public/"
node scripts/apply-branding.mjs
xattr -cr "$ROOT/ios/App/App/public" 2>/dev/null || true

cd "$IOS"
pod install

if [[ -z "$DEVICE_ID" ]]; then
  DEVICE_ID="$(xcrun xctrace list devices 2>/dev/null | grep -E 'iPad|iPhone' | grep -v Simulator | grep -v Offline | head -1 | sed -E 's/.*\(([0-9A-F-]+)\)$/\1/')"
fi

if [[ -z "$DEVICE_ID" ]]; then
  echo "No connected iOS device found. Plug in iPad and trust this Mac."
  exit 1
fi

echo "==> Building for device $DEVICE_ID"
rm -rf "$DERIVED"
xcodebuild -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  build

APP="$DERIVED/Build/Products/Debug-iphoneos/App.app"
if [[ ! -d "$APP" ]]; then
  echo "Build output missing: $APP"
  exit 1
fi

echo "==> Installing on device"
if xcrun devicectl device install app --device "$DEVICE_ID" "$APP" 2>/dev/null; then
  :
else
  # devicectl uses CoreDevice UUID; fall back to ios-deploy / devicectl by name
  CORE_ID="$(xcrun devicectl list devices 2>/dev/null | grep -i ipad | grep connected | head -1 | awk '{print $3}')"
  if [[ -n "$CORE_ID" ]]; then
    xcrun devicectl device install app --device "$CORE_ID" "$APP"
  else
    xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
  fi
fi

echo "==> Launching app"
if xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" 2>/dev/null; then
  :
else
  CORE_ID="$(xcrun devicectl list devices 2>/dev/null | grep -i ipad | grep connected | head -1 | awk '{print $3}')"
  xcrun devicectl device process launch --device "${CORE_ID:-$DEVICE_ID}" "$BUNDLE_ID" || true
fi

echo "Installed ShiftSwift HR on device $DEVICE_ID"
