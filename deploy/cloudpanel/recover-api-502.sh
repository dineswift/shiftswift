#!/usr/bin/env bash
# Recover ShiftSwift HR API after a 502 / connection refused following git checkout.
# Run on the CloudPanel server as root or a user with sudo for the API unit.
#
# Checkout only updates files. uvicorn will not listen on 127.0.0.1:8000 if:
#   - Python ImportError (qrcode / reportlab / missing template) crashes workers
#   - systemd unit is failed / inactive
#   - restart returned before workers bound the port
# Do not rsync the frontend until local /health is HTTP 200.
set -euo pipefail

API_ROOT="${SHIFTSWIFT_API_ROOT:-/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk}"
APP_ROOT="${SHIFTSWIFT_APP_ROOT:-/home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk}"
WWW_ROOT="${SHIFTSWIFT_WWW_ROOT:-/home/shiftswifthr/htdocs/www.shiftswifthr.co.uk}"
SERVICE="${SHIFTSWIFT_SERVICE:-shiftswifthr-api}"
HEALTH_URL="${SHIFTSWIFT_HEALTH_URL:-http://127.0.0.1:8000/health}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/wait-api-health.sh"

echo "==> repo ${API_ROOT}"
cd "${API_ROOT}"
git rev-parse --abbrev-ref HEAD
git log -1 --oneline

if [ ! -x backend_stub/.venv/bin/python ]; then
  echo "ERROR: backend_stub/.venv/bin/python missing — run deploy/cloudpanel/install-api.sh"
  exit 1
fi

echo "==> pip install (checkout does not install qrcode/reportlab into the venv)"
# shellcheck disable=SC1091
source backend_stub/.venv/bin/activate
pip install -q -r backend_stub/requirements.txt

echo "==> preflight import (same path uvicorn uses: main:app from backend_stub)"
(
  cd "${API_ROOT}/backend_stub"
  .venv/bin/python -c "import qrcode, reportlab; print('qrcode', qrcode.__version__, 'reportlab', reportlab.Version)"
  .venv/bin/python -c "from modules.time_punch.qr import punch_qr_png_bytes; from modules.rota.export_pdf import build_rota_print_pdf; print('qr + rota pdf import ok')"
  .venv/bin/python -c "import main; print('main:app import ok', main.app.title)"
)

if ! grep -q "def login_email_mfa_code" backend_stub/core/email_templates.py; then
  echo "ERROR: login_email_mfa_code is missing from backend_stub/core/email_templates.py"
  echo "       checkout cursor/fix-hr-login-mfa-email-39e0 (or merge it) and re-run."
  exit 1
fi
echo "    login_email_mfa_code present"

echo "==> ${SERVICE} before restart"
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl is-active "${SERVICE}" || true
  sudo systemctl status "${SERVICE}" --no-pager -l | tail -20 || true
else
  echo "WARNING: systemctl not found"
fi

echo "==> restart ${SERVICE}"
sudo systemctl reset-failed "${SERVICE}" 2>/dev/null || true
sudo systemctl restart "${SERVICE}"
sudo systemctl is-active "${SERVICE}" || true

wait_api_health

echo "==> rsync frontend (API is up)"
rsync -a --delete "${API_ROOT}/frontend/" "${APP_ROOT}/"
if [ -f "${API_ROOT}/frontend/app-root-index.html" ]; then
  cp "${API_ROOT}/frontend/app-root-index.html" "${APP_ROOT}/index.html"
fi
if [ -d "${WWW_ROOT}" ]; then
  rsync -a --delete "${API_ROOT}/frontend/" "${WWW_ROOT}/"
fi

echo "==> public health"
curl -sS "https://api.shiftswifthr.co.uk/health" || true
echo ""

echo "Done. Local ${HEALTH_URL} is HTTP 200."
echo "Retry https://app.shiftswifthr.co.uk/business-login.html"
echo "A wrong password should say invalid credentials, not Cannot reach the API."
