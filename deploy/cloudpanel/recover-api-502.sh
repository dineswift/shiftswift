#!/usr/bin/env bash
# Recover ShiftSwift HR API after a 502 following git checkout / restart.
# Run on the CloudPanel server as root or a user with sudo for the API unit.
set -euo pipefail

API_ROOT="${SHIFTSWIFT_API_ROOT:-/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk}"
SERVICE="${SHIFTSWIFT_SERVICE:-shiftswifthr-api}"

echo "==> repo ${API_ROOT}"
cd "${API_ROOT}"
git rev-parse --abbrev-ref HEAD
git log -1 --oneline

if ! grep -q "def login_email_mfa_code" backend_stub/core/email_templates.py; then
  echo "ERROR: login_email_mfa_code is missing from backend_stub/core/email_templates.py"
  echo "       checkout cursor/fix-hr-login-mfa-email-39e0 (or merge it) and re-run."
  exit 1
fi
echo "    login_email_mfa_code present"

echo "==> restart ${SERVICE}"
sudo systemctl restart "${SERVICE}"
sleep 3
sudo systemctl is-active "${SERVICE}"
sudo journalctl -u "${SERVICE}" -n 40 --no-pager || true

echo "==> local health"
if curl -sf "http://127.0.0.1:8000/health"; then
  echo ""
else
  echo "Local API not responding on :8000 — see journal above"
  sudo systemctl status "${SERVICE}" --no-pager -l || true
  exit 1
fi

echo "==> public health"
curl -sS "https://api.shiftswifthr.co.uk/health" || true
echo ""

echo "==> template import"
cd "${API_ROOT}/backend_stub"
.venv/bin/python -c "from core.email_templates import login_email_mfa_code; print(login_email_mfa_code(code='123456', minutes=10).subject)"

echo "Done. Retry https://app.shiftswifthr.co.uk/business-login.html"
echo "A wrong password should say invalid credentials, not Cannot reach the API."
