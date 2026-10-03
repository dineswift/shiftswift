#!/usr/bin/env bash
# Upload ShiftSwift HR IPA to App Store Connect.
#
# Auth (pick one):
#   export ASC_KEY_ID=XXXXXXXXXX
#   export ASC_ISSUER_ID=57246542-96fe-1a63-e053-0824d011072a
#   export ASC_KEY_PATH=$HOME/private_keys/AuthKey_XXXXXXXXXX.p8
#
#   — or —
#
#   export ASC_APPLE_ID=you@example.com
#   export ASC_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx   # app-specific password
#
# Then: npm run appstore:upload
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IPA="$ROOT/ios/build/export/App.ipa"
ALTOOL="/Applications/Xcode.app/Contents/Developer/usr/bin/altool"

if [[ ! -f "$IPA" ]]; then
  echo "Missing IPA. Run: npm run appstore:archive"
  exit 1
fi

if [[ ! -x "$ALTOOL" ]]; then
  echo "altool not found at $ALTOOL — install Xcode command-line tools."
  exit 1
fi

echo "IPA: $IPA ($(du -h "$IPA" | cut -f1))"

auth=()
if [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" && -n "${ASC_KEY_PATH:-}" ]]; then
  auth=(--api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID" --api-key-file "$ASC_KEY_PATH")
elif [[ -n "${ASC_APPLE_ID:-}" && -n "${ASC_APP_PASSWORD:-}" ]]; then
  auth=(--username "$ASC_APPLE_ID" --password "$ASC_APP_PASSWORD")
else
  echo ""
  echo "No upload credentials in environment."
  echo ""
  echo "Option A — App Store Connect API key (recommended):"
  echo "  export ASC_KEY_ID=..."
  echo "  export ASC_ISSUER_ID=..."
  echo "  export ASC_KEY_PATH=\$HOME/private_keys/AuthKey_....p8"
  echo ""
  echo "Option B — Apple ID app-specific password:"
  echo "  export ASC_APPLE_ID=..."
  echo "  export ASC_APP_PASSWORD=..."
  echo ""
  echo "Option C — Manual: Xcode → Window → Organizer → Archives → Distribute App"
  echo "  Or install Transporter from the Mac App Store and drop:"
  echo "  $IPA"
  exit 1
fi

echo "==> Upload to App Store Connect"
"$ALTOOL" --upload-package "$IPA" "${auth[@]}" --show-progress --verbose

echo ""
echo "Upload submitted. App Store Connect → Apps → ShiftSwift HR → TestFlight / Activity."
echo "First time? Create the app record with bundle ID co.uk.shiftswifthr.app if it does not exist."
