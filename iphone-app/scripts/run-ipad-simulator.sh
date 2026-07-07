#!/usr/bin/env bash
# Install ShiftSwift HR on iPad simulator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/ios/App"
SIM_NAME="${1:-iPad Pro 13-inch (M5)}"
DERIVED="$ROOT/ios/build/DerivedData"
BUNDLE_ID="co.uk.shiftswifthr.app"

cd "$ROOT"
node scripts/sync-www.mjs
rsync -a www/ "$IOS/App/public/"
node scripts/apply-branding.mjs
xattr -cr "$ROOT/ios" "$ROOT/node_modules/@capacitor" 2>/dev/null || true

cd "$IOS"
pod install

SIM_ID="$(xcrun simctl list devices available | grep "$SIM_NAME" | head -1 | sed -E 's/.*\(([A-F0-9-]+)\).*/\1/')"
if [[ -z "$SIM_ID" ]]; then
  echo "No simulator matching: $SIM_NAME"
  exit 1
fi

xcrun simctl boot "$SIM_ID" 2>/dev/null || true
open -a Simulator

rm -rf "$DERIVED"
xcodebuild -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$SIM_ID" \
  -derivedDataPath "$DERIVED" \
  build

APP="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"
xcrun simctl install "$SIM_ID" "$APP"
xcrun simctl launch "$SIM_ID" "$BUNDLE_ID"

echo "Installed on $SIM_NAME ($SIM_ID)"
