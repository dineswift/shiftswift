#!/usr/bin/env bash
# Run from repo root, or: bash deploy/cloudpanel/install-api.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/backend_stub/requirements.txt" ]; then
  ROOT_DIR="${SCRIPT_DIR}"
elif [ -f "${SCRIPT_DIR}/../../backend_stub/requirements.txt" ]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  echo "Cannot find backend_stub/requirements.txt — run from the shiftswift repo root."
  exit 1
fi
cd "${ROOT_DIR}"

echo "==> ShiftSwift HR API install"
echo "    Root: ${ROOT_DIR}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required"
  exit 1
fi

echo "==> Creating virtualenv"
python3 -m venv backend_stub/.venv
source backend_stub/.venv/bin/activate
pip install --upgrade pip
pip install -r backend_stub/requirements.txt

if [ ! -f backend_stub/.env ]; then
  JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  ENCRYPTION_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  cat > backend_stub/.env <<EOF
APP_ENV=production
APP_DOMAIN=shiftswifthr.co.uk
MARKETING_URL=https://www.shiftswifthr.co.uk
APP_URL=https://app.shiftswifthr.co.uk
API_URL=https://api.shiftswifthr.co.uk
DATABASE_URL=postgresql://shiftswift:CHANGE_ME@127.0.0.1:5432/shiftswift_hr
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_MINUTES=60
JWT_REFRESH_DAYS=7
MASTER_CUSTOMER_ID=999
CORS_ALLOW_ORIGINS=https://app.shiftswifthr.co.uk,https://www.shiftswifthr.co.uk,capacitor://localhost,ionic://localhost,http://localhost
TRUSTED_HOSTS=api.shiftswifthr.co.uk,app.shiftswifthr.co.uk,www.shiftswifthr.co.uk
FORCE_HTTPS=1
USE_DB=1
LOGIN_RATE_LIMIT=10
LOGIN_RATE_WINDOW_SECONDS=900
MAX_UPLOAD_BYTES=10485760
ENCRYPTION_KEY=${ENCRYPTION_KEY}
RTW_STORAGE_DIR=${ROOT_DIR}/uploads/rtw_immutable
DOCUMENTS_STORAGE_DIR=uploads/documents
AI_ENABLED=0
EOF
  mkdir -p uploads/rtw_immutable backend_stub/uploads/documents
  echo "Created backend_stub/.env — edit DATABASE_URL before migrations."
else
  echo "backend_stub/.env already exists — skipped."
fi

echo ""
echo "Install complete."
echo ""
echo "Next:"
echo "  1. Edit backend_stub/.env (DATABASE_URL, SMTP, Stripe)"
echo "  2. bash scripts/run_migrations.sh"
echo "  3. python3 scripts/seed_app_users.py"
echo "  4. CloudPanel Python start: backend_stub/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2"
echo "  5. curl https://api.shiftswifthr.co.uk/health"
echo ""
echo "See INSTALL-API.md in this folder."
