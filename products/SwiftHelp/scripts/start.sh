#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
BACKEND_PORT="${SWIFTHELP_API_PORT:-3200}"
FRONTEND_PORT="${SWIFTHELP_APP_PORT:-5380}"
PYTHON="python3"
if [ -x .venv/bin/python ] && .venv/bin/python -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  PYTHON=".venv/bin/python"
fi
cleanup() {
  kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
echo "SwiftHelp API → http://127.0.0.1:${BACKEND_PORT}"
( cd backend && "${PYTHON}" -m uvicorn main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --reload ) &
BACKEND_PID=$!
sleep 1
echo "SwiftHelp app → http://127.0.0.1:${FRONTEND_PORT}"
( cd frontend && "${PYTHON}" serve.py --port "${FRONTEND_PORT}" ) &
FRONTEND_PID=$!
echo ""
echo "  Desk     http://localhost:${FRONTEND_PORT}/app.html"
echo "  Login    http://localhost:${FRONTEND_PORT}/login.html"
echo "  Staff    http://localhost:${FRONTEND_PORT}/request.html"
echo "  API      http://localhost:${BACKEND_PORT}/docs"
echo "  Agent    it@swifthelp.local / Helpdesk-Demo-2026"
echo "  Staff    amira.khan@northgate.example / Request-Demo-2026"
echo ""
wait
