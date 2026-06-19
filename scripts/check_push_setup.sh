#!/usr/bin/env bash
# Production push reminder diagnostics — run on the API server.
# Usage: bash scripts/check_push_setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

echo "==> ShiftSwift HR — push reminder setup check"
echo "    $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

if [ -f "${ROOT}/scripts/load_env.sh" ] && [ -f "${ROOT}/backend_stub/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/scripts/load_env.sh"
  load_env_file "${ROOT}/backend_stub/.env"
  set +a
else
  echo "WARN: backend_stub/.env not found — env checks skipped"
fi

echo "==> 1. VAPID keys (Web Push)"
if [ -n "${VAPID_PUBLIC_KEY:-}" ] && [ -n "${VAPID_PRIVATE_KEY:-}" ]; then
  echo "    OK — VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set"
  echo "    Contact: ${VAPID_CONTACT_EMAIL:-${EMAIL_SUPPORT:-not set}}"
else
  echo "    FAIL — VAPID keys missing in backend_stub/.env"
  echo "    Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (see backend_stub/.env.example)"
  echo "    Generate: cd backend_stub && .venv/bin/python -c \"from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print('PUBLIC=', v.public_key); print('PRIVATE=', v.private_key)\""
fi
echo ""

echo "==> 2. Cron — run_platform_jobs.py (shift reminders need every ~15 min)"
found_cron=0
for user in "${USER}" shiftswifthr shiftswifthr-api root; do
  lines="$(crontab -u "${user}" -l 2>/dev/null | grep -E 'run_platform_jobs|platform_jobs' || true)"
  if [ -n "${lines}" ]; then
    found_cron=1
    echo "    crontab (${user}):"
    echo "${lines}" | sed 's/^/      /'
  fi
done
if [ "${found_cron}" -eq 0 ]; then
  echo "    FAIL — no run_platform_jobs.py cron found"
  echo "    Add (as shiftswifthr or API user):"
  echo "      */15 * * * * cd ${ROOT} && source scripts/load_env.sh && load_env_file backend_stub/.env && backend_stub/.venv/bin/python scripts/run_platform_jobs.py >> /var/log/shiftswifthr/platform-jobs.log 2>&1"
else
  if crontab -u "${USER}" -l 2>/dev/null | grep -qE 'run_platform_jobs'; then
    if crontab -u "${USER}" -l 2>/dev/null | grep 'run_platform_jobs' | grep -qvE '\*/[0-9]+|\* \* \* \*'; then
      echo "    WARN — cron may run less than every 15 minutes; shift reminders can be missed"
    fi
  fi
fi
echo ""

echo "==> 3. API health"
if command -v curl >/dev/null 2>&1; then
  curl -sf "http://127.0.0.1:8000/health" && echo "" || echo "    FAIL — local API :8000 not responding"
else
  echo "    skip (curl not installed)"
fi
echo ""

echo "==> 4. Database — subscriptions & recent pushes"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "    skip — DATABASE_URL not set"
else
  if [ -f "${ROOT}/backend_stub/.venv/bin/python" ]; then
    ROOT="${ROOT}" "${ROOT}/backend_stub/.venv/bin/python" - <<'PY'
import os
import sys
from pathlib import Path

root = Path(os.environ["ROOT"])
sys.path.insert(0, str(root / "backend_stub"))

try:
    import psycopg2
    from modules.push.service import push_configured
except ImportError as exc:
    print(f"    skip — {exc}")
    raise SystemExit(0)

print(f"    push_configured(): {push_configured()}")

url = os.environ.get("DATABASE_URL")
if not url:
    print("    skip — no DATABASE_URL")
    raise SystemExit(0)

conn = psycopg2.connect(url)
try:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_subscriptions')"
        )
        if not cur.fetchone()[0]:
            print("    FAIL — push_subscriptions table missing (run migrations)")
            raise SystemExit(0)

        cur.execute("SELECT COUNT(*) FROM push_subscriptions")
        subs = cur.fetchone()[0]
        print(f"    push_subscriptions: {subs} device(s)")

        cur.execute(
            """
            SELECT ps.tenant_id, ps.employee_id, e.first_name, e.last_name, ps.updated_at::date
            FROM push_subscriptions ps
            JOIN employees e ON e.id = ps.employee_id
            ORDER BY ps.updated_at DESC
            LIMIT 8
            """
        )
        rows = cur.fetchall()
        if rows:
            print("    Recent subscribers:")
            for row in rows:
                print(f"      tenant={row[0]} employee={row[1]} ({row[2]} {row[3]}) updated={row[4]}")
        else:
            print("    WARN — no employees have turned on alerts yet")

        cur.execute(
            """
            SELECT notification_key, sent_at
            FROM push_notification_log
            ORDER BY sent_at DESC
            LIMIT 6
            """
        )
        logs = cur.fetchall()
        if logs:
            print("    Recent push sends:")
            for key, sent in logs:
                print(f"      {sent} — {key}")
        else:
            print("    WARN — no pushes logged yet (cron may not have fired or VAPID missing)")
finally:
    conn.close()
PY
  else
    echo "    skip — backend_stub/.venv not found"
  fi
fi
echo ""

echo "==> 5. Dry-run shift reminder job (no sends if not due)"
if [ -n "${DATABASE_URL:-}" ] && [ -f "${ROOT}/backend_stub/.venv/bin/python" ]; then
  "${ROOT}/backend_stub/.venv/bin/python" "${ROOT}/scripts/run_platform_jobs.py" 2>/dev/null | tail -1 || true
fi
echo ""
echo "Done. Employees must: install PWA → Turn on alerts → allow notifications in phone settings."
