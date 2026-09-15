#!/usr/bin/env bash
# Wait until local uvicorn /health is reachable.
# Success: HTTP 200, or a 301/302/307/308 whose Location still points at /health.
#
# FORCE_HTTPS / SecurityHeadersMiddleware used to 307
#   http://127.0.0.1:8000/health → https://127.0.0.1:8000/health
# curl without -L then never sees 200, even though uvicorn is up.
# Do not follow that redirect: :8000 is plain HTTP, so https://127.0.0.1:8000 fails.
#
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

_health_redirect_is_up() {
  local code="$1"
  local loc="$2"
  local url="$3"
  case "${code}" in
    301|302|303|307|308) ;;
    *) return 1 ;;
  esac
  if printf '%s' "${loc}" | grep -qiE '/health(/|$|\?)'; then
    return 0
  fi
  # Empty Location but we probed /health — still means uvicorn answered.
  if [ -z "${loc}" ] && printf '%s' "${url}" | grep -qiE '/health(/|$|\?)'; then
    return 0
  fi
  return 1
}

wait_api_health() {
  local url="${SHIFTSWIFT_HEALTH_URL:-http://127.0.0.1:8000/health}"
  local attempts="${SHIFTSWIFT_HEALTH_ATTEMPTS:-15}"
  local sleep_s="${SHIFTSWIFT_HEALTH_SLEEP:-2}"
  local service="${SHIFTSWIFT_SERVICE:-shiftswifthr-api}"
  local i code loc curl_out
  local body
  body="$(mktemp)"

  echo "==> wait for ${url} HTTP 200 (or 307 to /health) (up to $((attempts * sleep_s))s)"
  for i in $(seq 1 "${attempts}"); do
    curl_out="$(curl -sS -o "${body}" -w "%{http_code} %{redirect_url}" --connect-timeout 1 --max-time 2 "${url}" 2>/dev/null || true)"
    code="$(printf '%s' "${curl_out}" | awk '{print $1}')"
    loc="$(printf '%s' "${curl_out}" | awk '{print $2}')"
    if [ -z "${code}" ]; then
      code="000"
    fi
    if [ "${code}" = "200" ]; then
      echo "    HTTP 200 after ${i} attempt(s) — API is up"
      cat "${body}"
      echo ""
      rm -f "${body}"
      return 0
    fi
    if _health_redirect_is_up "${code}" "${loc}" "${url}"; then
      echo "    HTTP ${code} Location: ${loc:-"(empty)"} after ${i} attempt(s) — API is up"
      echo "    uvicorn is serving; FORCE_HTTPS redirected HTTP /health (do not curl -L on :8000)"
      rm -f "${body}"
      return 0
    fi
    echo "    attempt ${i}/${attempts}: HTTP ${code} (not listening yet, still starting, or crashed)"
    sleep "${sleep_s}"
  done

  rm -f "${body}"
  echo "ERROR: ${url} did not return HTTP 200 or a /health redirect — uvicorn is not serving. Frontend rsync skipped."
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
