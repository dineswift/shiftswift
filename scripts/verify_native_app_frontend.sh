#!/usr/bin/env bash
# Check native iOS hybrid assets are live on app.shiftswifthr.co.uk
set -euo pipefail

APP_URL="${SHIFTSWIFT_APP_URL:-https://app.shiftswifthr.co.uk}"
FAIL=0

check() {
  local path="$1"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" "${APP_URL}/${path}")"
  if [ "$code" = "200" ]; then
    echo "OK  ${path} (${code})"
  else
    echo "FAIL ${path} (${code})"
    FAIL=1
  fi
}

echo "Checking ${APP_URL} native app assets..."
check "native-app.js"
check "native-app-bootstrap.js"
check "native-app-chrome.css"
check "native-app-login.css"
check "sign-in.html"
check "passkey-auth.js"
check "native-app-login.html"
check "unified-login.js"
check "session-auth.js"
check "employee.html"
check "admin.html"

if [ "$FAIL" -eq 0 ]; then
  echo "All native app frontend assets are live."
else
  echo "Some assets missing — run deploy/cloudpanel/sync-frontend-only.sh on the server after git pull."
  exit 1
fi
