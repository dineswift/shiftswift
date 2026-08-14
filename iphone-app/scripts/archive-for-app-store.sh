#!/usr/bin/env bash
# Build App Store IPA for ShiftSwift HR (run on Mac with Xcode signing configured).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/ios"
APP="$IOS/App"
ARCHIVE="$IOS/build/ShiftSwiftHR.xcarchive"
EXPORT="$IOS/build/export"
EXPORT_PLIST="$IOS/ExportOptions-ipa.plist"

echo "==> Apply branding (app icon + splash)"
node scripts/apply-branding.mjs

echo "==> Sync bundled www"
cd "$ROOT"
node scripts/sync-www.mjs
rsync -a www/ "$APP/App/public/"
xattr -cr "$APP/App/public" 2>/dev/null || true

echo "==> Pod install"
cd "$APP"
pod install

echo "==> Archive (Release, generic iOS — iPhone + iPad)"
rm -rf "$ARCHIVE" "$EXPORT"
# Build off Desktop to avoid File Provider xattrs that break codesign
DERIVED="${SSHR_DERIVED_DATA:-/tmp/sshr-AppStoreDerivedData}"
rm -rf "$DERIVED"
COPYFILE_DISABLE=1 xcodebuild -workspace App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  archive

echo "==> Export IPA for App Store Connect"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -allowProvisioningUpdates

IPA="$EXPORT/App.ipa"
if [[ -f "$IPA" ]]; then
  echo ""
  echo "IPA ready: $IPA"
  echo "Upload with Transporter (macOS) or Xcode Organizer → Distribute App"
else
  echo "Export finished — check $EXPORT"
  ls -la "$EXPORT"
fi
