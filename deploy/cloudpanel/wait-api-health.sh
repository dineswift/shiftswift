#!/usr/bin/env bash
# Wait until local uvicorn /health returns HTTP 200.
# Usage:
#   bash deploy/cloudpanel/wait-api-health.sh
#   source deploy/cloudpanel/wait-api-health.sh && wait_api_health
#
# Env:
#   SHIFTSWIFT_HEALTH_URL       default http://127.0.0.1:8000/health
#   SHIFTSWIFT_HEALTH_ATTEMPTS  default 15
#   SHIFTSWIFT_HEALTH_SLEEP     default 2 (seconds)
#   SHIFTSWIFT_SERVICE          default shiftswifthr-api
#   SHIFTSWIFT_SKIP_JOURNAL     set to 1 to skip journalctl/status on failure
set -euo pipefail

wait_api_health() {
  local url="${SHIFTSWIFT_HEALTH_URL:-http://127.0.0.1:8000/health}"
  local attempts="${SHIFTSWIFT_HEALTH_ATTEMPTS:-15}"
  local sleep_s="${SHIFTSWIFT_HEALTH_SLEEP:-2}"
  local service="${SHIFTSWIFT_SERVICE:-shiftswifthr-api}"
  local i code body
  body="$(mktemp)"

  echo "==> wait for ${url} HTTP 200 (up to $((attempts * sleep_s))s)"
  for i in $(seq 1 "${attempts}"); do
    code="$(curl -sS -o "${body}" -w "%{http_code}" --connect-timeout 1 --max-time 2 "${url}" 2>/dev/null || true)"
    if [ -z "${code}" ]; then
      code="000"
    fi
    if [ "${code}" = "200" ]; then
      echo "    HTTP 200 after ${i} attempt(s)"
      cat "${body}"
      echo ""
      rm -f "${body}"
      return 0
    fi
    echo "    attempt ${i}/${attempts}: HTTP ${code} (not listening yet, still starting, or crashed)"
    sleep "${sleep_s}"
  done

  rm -f "${body}"
  echo "ERROR: ${url} did not return HTTP 200 — uvicorn is not serving. Frontend rsync skipped."
  if [ "${SHIFTSWIFT_SKIP_JOURNAL:-0}" != "1" ]; then
    echo "==> journalctl -u ${service} -n 80 --no-pager"
    if command -v journalctl >/dev/null 2>&1; then
      sudo -n journalctl -u "${service}" -n 80 --no-pager 2>/dev/null \
        || journalctl -u "${service}" -n 80 --no-pager 2>/dev/null \
        || true
    fi
    echo "==> systemctl status ${service}"
    if command -v systemctl >/dev/null 2>&1; then
      sudo -n systemctl status "${service}" --no-pager -l 2>/dev/null \
        || systemctl status "${service}" --no-pager -l 2>/dev/null \
        || true
    fi
  fi
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  wait_api_health
fi
