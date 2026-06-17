#!/usr/bin/env bash
# Automated checks from docs/pilot_qa_checklist.md (Sprint 4).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}/backend_stub"

if [ ! -x .venv/bin/python ]; then
  echo "Missing backend_stub/.venv — run: bash scripts/install_local.sh"
  exit 1
fi

PY=.venv/bin/python

echo "Running pilot QA pytest bundle…"
"${PY}" -m pytest \
  tests/test_plan_features.py \
  tests/test_time_punch.py \
  tests/test_signup_legal.py \
  tests/test_rota_attendance.py \
  tests/test_rota_export_attendance.py \
  tests/test_rota_export_pdf.py \
  tests/test_missed_punch_alerts.py \
  -q

echo ""
echo "Pilot automated QA: all tests passed."
echo "Next: complete manual checks in docs/pilot_qa_checklist.md on staging/production."
