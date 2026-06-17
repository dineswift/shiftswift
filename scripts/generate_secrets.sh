#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/backend_stub/.env.production.example"

JWT_SECRET="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"

cat > "${ENV_FILE}" <<EOF
# Copy to backend_stub/.env before production deployment
APP_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/shiftswift_hr
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_MINUTES=60
JWT_REFRESH_DAYS=7
MASTER_CUSTOMER_ID=999
CORS_ALLOW_ORIGINS=https://app.yourdomain.com
TRUSTED_HOSTS=app.yourdomain.com,api.yourdomain.com
FORCE_HTTPS=1
USE_DB=1
LOGIN_RATE_LIMIT=10
LOGIN_RATE_WINDOW_SECONDS=900
MAX_UPLOAD_BYTES=10485760
RTW_STORAGE_DIR=/var/lib/shiftswift-hr/rtw
DOCUMENTS_STORAGE_DIR=/var/lib/shiftswift-hr/documents
# CloudPanel: run deploy/cloudpanel/ensure-storage-dirs.sh (or pull-production.sh) once with sudo
# to create /var/lib/shiftswift-hr and chown to the API user. Or use uploads/documents instead:
# DOCUMENTS_STORAGE_DIR=uploads/documents
EOF

echo "Generated ${ENV_FILE}"
echo "Review values, copy to backend_stub/.env, then run migrations + seed_app_users.py with strong passwords."
