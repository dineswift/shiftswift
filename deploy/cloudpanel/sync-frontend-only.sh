#!/usr/bin/env bash
# Sync frontend/ to app.shiftswifthr.co.uk only (no API restart).
# Run on the production server after git pull, or from CI.
set -euo pipefail

API_ROOT="${SHIFTSWIFT_API_ROOT:-/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk}"
APP_ROOT="${SHIFTSWIFT_APP_ROOT:-/home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk}"

if [ ! -d "${API_ROOT}/frontend" ]; then
  echo "ERROR: ${API_ROOT}/frontend not found. Run git pull in ${API_ROOT} first."
  exit 1
fi

echo "==> Sync frontend → ${APP_ROOT}"
rsync -a --delete "${API_ROOT}/frontend/" "${APP_ROOT}/"
cp "${API_ROOT}/frontend/app-root-index.html" "${APP_ROOT}/index.html"

echo "==> Verify native iOS app assets"
for path in \
  native-app.js \
  native-app-bootstrap.js \
  native-app-chrome.css \
  native-app-login.css \
  native-app-login.html \
  session-auth.js; do
  if [ ! -f "${APP_ROOT}/${path}" ]; then
    echo "MISSING: ${path}"
    exit 1
  fi
  echo "  OK ${path}"
done

echo "==> Done. Native app pages will load from app.shiftswifthr.co.uk on next launch."
