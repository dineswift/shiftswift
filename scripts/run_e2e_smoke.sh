#!/usr/bin/env bash
# Run Playwright HR admin smoke tests against local stack (or existing servers).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}/e2e"

if [ ! -d node_modules/@playwright/test ]; then
  echo "Installing Playwright test runner…"
  npm install
fi

if [ ! -d "$HOME/.cache/ms-playwright/chromium-"* ] 2>/dev/null; then
  echo "Installing Chromium for Playwright…"
  npx playwright install chromium
fi

echo "Running admin smoke tests (reuse existing local servers when running)…"
export E2E_SKIP_WEBSERVER="${E2E_SKIP_WEBSERVER:-}"
if curl -sf "${E2E_API_URL:-http://127.0.0.1:3000}/health" >/dev/null 2>&1; then
  export E2E_SKIP_WEBSERVER=1
  echo "Detected API on ${E2E_API_URL:-http://127.0.0.1:3000} — skipping webServer boot."
else
  echo "No API detected — Playwright will start bash scripts/start_local.sh"
fi

npm test
