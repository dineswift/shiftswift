#!/usr/bin/env bash
# Install SwiftCRM on this machine (API + three apps: agency, tenant, landlord).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

echo "Installing SwiftCRM into ${ROOT}"

if python3 -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "Using system/user Python (fastapi already installed)."
elif python3 -m venv .venv >/dev/null 2>&1; then
  .venv/bin/pip install -q -r backend/requirements.txt
  echo "Created .venv and installed requirements."
else
  python3 -m pip install --user fastapi 'uvicorn[standard]' pydantic
  echo "Installed FastAPI into the user site-packages."
fi

mkdir -p backend/data
if [ "${SWIFTCRM_RESET:-0}" = "1" ]; then
  rm -f backend/data/swiftcrm.db
  echo "Reset demo database."
fi

python3 - <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, str(Path("backend").resolve()))
from data import init_db
init_db()
print("Database ready:", Path("backend/data/swiftcrm.db").resolve())
PY

chmod +x scripts/start.sh frontend/serve.py
echo ""
echo "Installed. Start with:"
echo "  bash ${ROOT}/scripts/start.sh"
echo ""
echo "Agency   http://localhost:5280/login.html     agency@swiftcrm.local / Lettings-Demo-2026"
echo "Tenant   http://localhost:5280/tenant.html    hannah.reid@example.com / Tenant-Demo-2026"
echo "Landlord http://localhost:5280/landlord.html  priya@mapperleyholdings.example / Landlord-Demo-2026"
