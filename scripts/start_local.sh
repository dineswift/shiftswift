#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [ ! -d backend_stub/.venv ]; then
  echo "Run bash scripts/install_local.sh first."
  exit 1
fi

source backend_stub/.venv/bin/activate
set -a
if [ -n "${CI_E2E:-}" ]; then
  export APP_ENV="${APP_ENV:-development}"
  export USE_DB="${USE_DB:-0}"
  export JWT_SECRET="${JWT_SECRET:-ci-e2e-jwt-secret-not-for-production}"
  FRONTEND_PORT="${FRONTEND_PORT:-5173}"
  export CORS_ALLOW_ORIGINS="${CORS_ALLOW_ORIGINS:-http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}}"
  export TRUSTED_HOSTS="${TRUSTED_HOSTS:-localhost,127.0.0.1}"
  export FORCE_HTTPS="${FORCE_HTTPS:-0}"
  export ENCRYPTION_KEY="${ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
elif [ -f backend_stub/.env ]; then
  source backend_stub/.env
fi
set +a

BACKEND_PORT="${BACKEND_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

cleanup() {
  kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting ShiftSwift HR (shiftswifthr.co.uk) backend on http://127.0.0.1:${BACKEND_PORT}"
(
  cd backend_stub
  uvicorn main:app --host 127.0.0.1 --port "${BACKEND_PORT}" --reload --reload-dir . --reload-exclude '.venv/*'
) &
BACKEND_PID=$!

echo "Waiting for API health on http://127.0.0.1:${BACKEND_PORT}/health …"
for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "Backend exited before health check passed."
    exit 1
  fi
  sleep 1
done
if ! curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
  echo "API did not become healthy within 90s."
  exit 1
fi

sleep 1

echo "Starting ShiftSwift HR frontend on http://127.0.0.1:${FRONTEND_PORT}"
(
  cd frontend
  python3 serve_secure.py --port "${FRONTEND_PORT}"
) &
FRONTEND_PID=$!

echo "Waiting for frontend on http://127.0.0.1:${FRONTEND_PORT}/business-login.html …"
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${FRONTEND_PORT}/business-login.html" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    echo "Frontend exited before becoming reachable."
    exit 1
  fi
  sleep 1
done

echo ""
echo "Ready:"
echo "  Website / Admin: http://localhost:${FRONTEND_PORT}"
echo "  Business login:  http://localhost:${FRONTEND_PORT}/business-login.html"
echo "  Admin console:   http://localhost:${FRONTEND_PORT}/admin.html"
echo "  API home:        http://localhost:${BACKEND_PORT}/"
echo "  API login:       http://localhost:${BACKEND_PORT}/app/business-login.html"
echo "  API docs:        http://localhost:${BACKEND_PORT}/docs"
echo "  API health:      http://localhost:${BACKEND_PORT}/health"
echo ""
echo "Press Ctrl+C to stop."

wait
