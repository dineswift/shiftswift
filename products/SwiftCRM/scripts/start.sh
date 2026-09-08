#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

BACKEND_PORT="${SWIFTCRM_API_PORT:-3100}"
FRONTEND_PORT="${SWIFTCRM_APP_PORT:-5280}"

PYTHON="python3"
if [ -x .venv/bin/python ] && .venv/bin/python -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  PYTHON=".venv/bin/python"
elif python3 -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  PYTHON="python3"
else
  python3 -m venv .venv
  .venv/bin/pip install -q -r backend/requirements.txt
  PYTHON=".venv/bin/python"
fi

cleanup() {
  kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "SwiftCRM API → http://127.0.0.1:${BACKEND_PORT}"
(
  cd backend
  "${PYTHON}" -m uvicorn main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --reload
) &
BACKEND_PID=$!

sleep 1

echo "SwiftCRM app → http://127.0.0.1:${FRONTEND_PORT}"
(
  cd frontend
  "${PYTHON}" serve.py --port "${FRONTEND_PORT}"
) &
FRONTEND_PID=$!

echo ""
echo "  Marketing   http://localhost:${FRONTEND_PORT}"
echo "  Login       http://localhost:${FRONTEND_PORT}/login.html"
echo "  Agency app  http://localhost:${FRONTEND_PORT}/app.html"
echo "  API docs    http://localhost:${BACKEND_PORT}/docs"
echo "  Demo        agency@swiftcrm.local  /  Lettings-Demo-2026"
echo ""
echo "Press Ctrl+C to stop."
wait
