#!/usr/bin/env bash
# Upload ShiftSwift HR AAB to Google Play Console.
#
# Auth (pick one):
#   export PLAY_SERVICE_ACCOUNT_JSON=/path/to/play-upload-service-account.json
#   export PLAY_PACKAGE_NAME=co.uk.shiftswifthr.app   # optional, default below
#
#   — or upload manually in Play Console → Release → Production/Testing
#
# Then: npm run playstore:upload
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AAB="$ROOT/android/app/build/outputs/bundle/release/app-release.aab"
PACKAGE="${PLAY_PACKAGE_NAME:-co.uk.shiftswifthr.app}"
TRACK="${PLAY_TRACK:-internal}"

if [[ ! -f "$AAB" ]]; then
  echo "Missing AAB. Run: npm run playstore:archive"
  exit 1
fi

echo "AAB: $AAB ($(du -h "$AAB" | cut -f1))"
echo "Package: $PACKAGE"
echo "Track: $TRACK"

if [[ -z "${PLAY_SERVICE_ACCOUNT_JSON:-}" || ! -f "${PLAY_SERVICE_ACCOUNT_JSON}" ]]; then
  echo ""
  echo "No Play Console upload credentials in environment."
  echo ""
  echo "Option A — Service account (recommended for CI):"
  echo "  1. Play Console → Setup → API access → Create service account"
  echo "  2. Grant Release manager (or Admin) on the app"
  echo "  3. export PLAY_SERVICE_ACCOUNT_JSON=/path/to/key.json"
  echo "  4. npm run playstore:upload"
  echo ""
  echo "Option B — Manual upload:"
  echo "  Play Console → ShiftSwift HR → Test and release → $TRACK testing"
  echo "  Create release → Upload: $AAB"
  echo ""
  echo "First time? Create the app with package name $PACKAGE if it does not exist."
  exit 1
fi

if ! python3 -c "import google.auth" 2>/dev/null; then
  echo "Installing Google API client (one-time)…"
  python3 -m pip install --user google-api-python-client google-auth >/dev/null
fi

python3 "$ROOT/scripts/upload-play-aab.py" \
  --aab "$AAB" \
  --package "$PACKAGE" \
  --track "$TRACK" \
  --credentials "$PLAY_SERVICE_ACCOUNT_JSON"

echo ""
echo "Upload submitted. Play Console → ShiftSwift HR → $TRACK track → Review release."
