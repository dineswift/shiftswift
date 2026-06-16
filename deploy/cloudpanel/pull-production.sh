#!/usr/bin/env bash
# Pull latest shiftswift from GitHub and deploy API + frontend on CloudPanel.
# Run on the server as a user that can restart shiftswifthr-api (sudo once if needed).
set -euo pipefail

REPO_URL="${SHIFTSWIFT_REPO_URL:-https://github.com/kharel2020/shiftswift.git}"
API_ROOT="${SHIFTSWIFT_API_ROOT:-/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk}"
APP_ROOT="${SHIFTSWIFT_APP_ROOT:-/home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk}"
WWW_ROOT="${SHIFTSWIFT_WWW_ROOT:-/home/shiftswifthr/htdocs/www.shiftswifthr.co.uk}"
SERVICE="${SHIFTSWIFT_SERVICE:-shiftswifthr-api}"

echo "==> ShiftSwift HR production pull"
echo "    API:  ${API_ROOT}"
echo "    App:  ${APP_ROOT}"
echo "    WWW:  ${WWW_ROOT}"

if [ ! -d "${API_ROOT}/.git" ]; then
  echo "No git repo at ${API_ROOT}. First-time setup:"
  echo "  cd ${API_ROOT} && git clone ${REPO_URL} ."
  exit 1
fi

cd "${API_ROOT}"
echo "==> git pull"
git pull --ff-only

if [ -f backend_stub/.venv/bin/activate ]; then
  # shellcheck disable=SC1091
  source backend_stub/.venv/bin/activate
  echo "==> pip install"
  pip install -q -r backend_stub/requirements.txt
elif [ -f deploy/cloudpanel/install-api.sh ]; then
  echo "==> venv missing — running install-api.sh"
  bash deploy/cloudpanel/install-api.sh
  # shellcheck disable=SC1091
  source backend_stub/.venv/bin/activate
else
  echo "ERROR: backend_stub/.venv missing and install-api.sh not found"
  exit 1
fi

if [ -f backend_stub/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source "${API_ROOT}/scripts/load_env.sh"
  load_env_file "${API_ROOT}/backend_stub/.env"
  set +a
  echo "==> migrations"
  bash scripts/run_migrations.sh
  if [ -f scripts/seed_billing_catalog.py ]; then
    echo "==> seed billing catalog"
    python scripts/seed_billing_catalog.py
  fi
else
  echo "WARNING: backend_stub/.env missing — skipped migrations"
fi

if command -v systemctl >/dev/null 2>&1; then
  echo "==> restart ${SERVICE}"
  sudo systemctl restart "${SERVICE}"
else
  echo "WARNING: systemctl not found — restart API manually"
fi

echo "==> sync frontend"
rsync -a --delete "${API_ROOT}/frontend/" "${APP_ROOT}/"

# WWW: marketing + legal only — HR app (login, admin, OPS) lives on app.shiftswifthr.co.uk
echo "==> sync marketing frontend to WWW (excluding HR app pages)"
rsync -a --delete --delete-excluded \
  --include='/' \
  --include='index.html' \
  --include='landing.html' \
  --include='privacy-policy.html' \
  --include='cookies.html' \
  --include='eula.html' \
  --include='dpa.html' \
  --include='payment-terms.html' \
  --include='legal.css' \
  --include='payroll-export-guide.html' \
  --include='staff-export-guide.html' \
  --include='compliance-checklist.html' \
  --include='landing.css' \
  --include='theme.css' \
  --include='pricing.css' \
  --include='landing-*.js' \
  --include='pricing.js' \
  --include='cookie-consent.js' \
  --include='cookie-consent.css' \
  --include='brand-config.js' \
  --include='assets/' \
  --include='assets/**' \
  --include='docs/' \
  --include='docs/**' \
  --exclude='*' \
  "${API_ROOT}/frontend/" "${WWW_ROOT}/"

# rsync --delete alone keeps stale HR pages on www (they still exist in source but are filtered out)
WWW_FORBIDDEN=(
  business-login.html
  admin.html
  employee.html
  signup.html
  ops-9x7k2.html
  master.html
  punch.html
)
for page in "${WWW_FORBIDDEN[@]}"; do
  rm -f "${WWW_ROOT}/${page}"
done
for page in "${WWW_FORBIDDEN[@]}"; do
  if [ -f "${WWW_ROOT}/${page}" ]; then
    echo "ERROR: ${WWW_ROOT}/${page} must not exist on www — check WWW rsync filters"
    exit 1
  fi
done
echo "    www has no HR app login pages"

echo "==> verify marketing assets (WWW)"
for page in index.html landing.css theme.css pricing.css; do
  if [ ! -f "${WWW_ROOT}/${page}" ]; then
    echo "ERROR: missing ${WWW_ROOT}/${page} after rsync — theme.css is required for landing.css variables"
    exit 1
  fi
done
echo "    marketing CSS OK"

echo "==> verify legal pages (WWW + App)"
LEGAL_PAGES=(
  payment-terms.html
  privacy-policy.html
  cookies.html
  eula.html
  dpa.html
  legal.css
)
LEGAL_DOCS=(
  docs/b2b_payment_terms.md
  docs/privacy-policy.md
  docs/cookies.md
  docs/eula_hr_module.md
  docs/hr_dpa_outline.md
)
for root in "${APP_ROOT}" "${WWW_ROOT}"; do
  for page in "${LEGAL_PAGES[@]}"; do
    if [ ! -f "${root}/${page}" ]; then
      echo "ERROR: missing ${root}/${page} after rsync — run git pull on API repo first"
      exit 1
    fi
  done
  for doc in "${LEGAL_DOCS[@]}"; do
    if [ ! -f "${root}/${doc}" ]; then
      echo "ERROR: missing ${root}/${doc} after rsync"
      exit 1
    fi
  done
done
echo "    legal pages OK"

echo "==> verify Time Clock PWA (App)"
PWA_FILES=(
  punch.html
  punch.js
  punch.css
  app-sw.js
  punch-sw.js
  punch-manifest.webmanifest
  admin-manifest.webmanifest
  employee-manifest.webmanifest
  portal-pwa-install.js
  admin.html
  employee.html
)
for page in "${PWA_FILES[@]}"; do
  if [ ! -f "${APP_ROOT}/${page}" ]; then
    echo "ERROR: missing ${APP_ROOT}/${page} after rsync"
    exit 1
  fi
done
echo "    Time Clock PWA OK"

echo "==> verify password reset pages (App)"
RESET_FILES=(
  forgot-password.html
  reset-password.html
  password-reset.js
)
for page in "${RESET_FILES[@]}"; do
  if [ ! -f "${APP_ROOT}/${page}" ]; then
    echo "ERROR: missing ${APP_ROOT}/${page} after rsync — run git pull on API repo first"
    exit 1
  fi
done
if grep -q 'mailto:.*password reset' "${APP_ROOT}/business-login.html" 2>/dev/null; then
  echo "ERROR: business-login.html still uses mailto password reset — git pull and rsync again"
  exit 1
fi
if ! grep -q 'forgot-password.html' "${APP_ROOT}/business-login.html" 2>/dev/null; then
  echo "ERROR: business-login.html missing forgot-password link"
  exit 1
fi
echo "    password reset pages OK"

echo "==> verify payroll export guide (App)"
for root in "${APP_ROOT}" "${WWW_ROOT}"; do
  if [ ! -f "${root}/payroll-export-guide.html" ]; then
    echo "ERROR: missing ${root}/payroll-export-guide.html after rsync"
    exit 1
  fi
done
echo "    payroll export guide OK"

echo "==> health check"
if command -v curl >/dev/null 2>&1; then
  health_ok=0
  for _ in 1 2 3 4 5; do
    if curl -sf "http://127.0.0.1:8000/health" >/dev/null; then
      health_ok=1
      break
    fi
    sleep 2
  done
  if [ "${health_ok}" -eq 1 ]; then
    curl -s "http://127.0.0.1:8000/health"
    echo ""
  else
    echo "Local API not responding on :8000 after restart — check logs:"
    echo "  sudo journalctl -u ${SERVICE} -n 40 --no-pager"
    sudo systemctl status "${SERVICE}" --no-pager -l 2>/dev/null | tail -20 || true
  fi
fi

echo "Done."
