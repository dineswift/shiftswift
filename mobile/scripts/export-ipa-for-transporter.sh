#!/bin/bash
# Build a signed ShiftSwift HR .ipa on macOS and drop it on the Desktop for Apple Transporter.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on your Mac (not Linux). Open Terminal on the MacBook and run it from the repo." >&2
  exit 1
fi

if pgrep -x Xcode >/dev/null 2>&1; then
  echo "Quit Xcode first (Cmd+Q), then run this again so it does not use a stale project." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ "$BRANCH" != "cursor/ios-ipad-updates-b650" ]]; then
  echo "This Mac copy is on branch '${BRANCH:-unknown}', not cursor/ios-ipad-updates-b650." >&2
  echo "Quit Xcode, then run:" >&2
  echo "  cd $REPO" >&2
  echo "  git fetch origin" >&2
  echo "  git checkout -f -B cursor/ios-ipad-updates-b650 origin/cursor/ios-ipad-updates-b650" >&2
  exit 1
fi
IOS_APP="$ROOT/ios-app/App"
EXPORT_PLIST="$ROOT/ios-app/ExportOptions.Transporter.plist"
BUILD_DIR="$ROOT/build/transporter"
ARCHIVE_PATH="$BUILD_DIR/ShiftSwiftHR.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
DESKTOP="${HOME}/Desktop"
IPA_NAME="ShiftSwiftHR-1.0.3-12.ipa"

if [[ ! -d "$IOS_APP" ]]; then
  echo "Missing $IOS_APP — clone github.com/dineswift/shiftswift and checkout cursor/ios-ipad-updates-b650 first." >&2
  exit 1
fi

echo "==> Syncing Capacitor iOS project"
cd "$ROOT"
npm install
npm run ios:sync

echo "==> Installing CocoaPods"
cd "$IOS_APP"
pod install

echo "==> Archiving ShiftSwift HR (co.uk.shiftswifthr.app) for iPhone + iPad"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
xattr -cr "$IOS_APP" 2>/dev/null || true
xcodebuild \
  -workspace "$IOS_APP/App.xcworkspace" \
  -scheme App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=C3G882KGJZ \
  archive

echo "==> Exporting App Store IPA for Transporter"
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"
if ! xcodebuild -exportArchive -archivePath "$ARCHIVE_PATH" -exportPath "$EXPORT_DIR" -exportOptionsPlist "$EXPORT_PLIST"; then
  echo "app-store-connect export failed; retrying with method app-store (older Xcode)." >&2
  TMP_PLIST="$(mktemp /tmp/sshr-export.XXXXXX.plist)"
  sed 's/app-store-connect/app-store/' "$EXPORT_PLIST" > "$TMP_PLIST"
  xcodebuild -exportArchive -archivePath "$ARCHIVE_PATH" -exportPath "$EXPORT_DIR" -exportOptionsPlist "$TMP_PLIST"
  rm -f "$TMP_PLIST"
fi

EXPORTED_IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -n 1)"
if [[ -z "$EXPORTED_IPA" ]]; then
  echo "No .ipa was exported. In Xcode: Product → Archive → Distribute App → App Store Connect → Export." >&2
  exit 1
fi

DEST="$DESKTOP/$IPA_NAME"
cp "$EXPORTED_IPA" "$DEST"
echo
echo "IPA ready for Transporter:"
echo "  $DEST"
echo
echo "Next: open Transporter, drag that file in, and click Deliver."
if [[ -d "/Applications/Transporter.app" ]]; then
  open -a Transporter "$DEST" || open -a Transporter
else
  echo "Transporter is not installed. Get it from the Mac App Store, then drag the IPA onto it."
  open "$DESKTOP"
fi
