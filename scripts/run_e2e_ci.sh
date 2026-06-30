#!/usr/bin/env bash
# CI entry point: Python venv + no-DB API + Playwright HR admin smoke tests.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

PYTHON="${PYTHON:-python3.11}"
if ! command -v "${PYTHON}" >/dev/null 2>&1; then
  PYTHON=python3
fi

if [ ! -d backend_stub/.venv ]; then
  echo "==> Creating Python virtualenv for CI"
  "${PYTHON}" -m venv backend_stub/.venv
fi

# shellcheck disable=SC1091
source backend_stub/.venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r backend_stub/requirements.txt

echo "==> CI stack env (USE_DB=0 — dev credential login, no Postgres)"
export CI_E2E=1
export CI=1
export APP_ENV=development
export USE_DB=0
export JWT_SECRET=ci-e2e-jwt-secret-not-for-production
export JWT_ACCESS_MINUTES=60
export JWT_REFRESH_DAYS=7
export MASTER_CUSTOMER_ID=999
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
export CORS_ALLOW_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"
export TRUSTED_HOSTS=localhost,127.0.0.1
export FORCE_HTTPS=0
export LOGIN_RATE_LIMIT=100
export LOGIN_RATE_WINDOW_SECONDS=60
export MAX_UPLOAD_BYTES=10485760
export ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

echo "==> Installing Playwright test runner"
cd "${ROOT_DIR}/e2e"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "==> Installing Chromium for Playwright"
npx playwright install chromium
if [ "$(uname -s)" = "Linux" ]; then
  npx playwright install-deps chromium
fi

echo "==> Running admin smoke tests"
export E2E_SKIP_WEBSERVER=""
npm test
