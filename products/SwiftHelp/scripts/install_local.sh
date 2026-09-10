#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
echo "Installing SwiftHelp into ${ROOT}"
if python3 -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "Using system Python (fastapi already installed)."
elif python3 -m venv .venv >/dev/null 2>&1; then
  .venv/bin/pip install -q -r backend/requirements.txt
else
  python3 -m pip install --user fastapi 'uvicorn[standard]' pydantic
fi
mkdir -p backend/data
if [ "${SWIFTHELP_RESET:-0}" = "1" ]; then
  rm -f backend/data/swifthelp.db
  echo "Reset demo database."
fi
python3 - <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, str(Path("backend").resolve()))
from data import init_db
init_db()
print("Database ready:", Path("backend/data/swifthelp.db").resolve())
PY
chmod +x scripts/start.sh frontend/serve.py
echo ""
echo "Start with: bash ${ROOT}/scripts/start.sh"
echo "Agent      http://localhost:5380/login.html   it@swifthelp.local / Helpdesk-Demo-2026"
echo "Requester  http://localhost:5380/request.html amira.khan@northgate.example / Request-Demo-2026"
