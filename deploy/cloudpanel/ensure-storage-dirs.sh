#!/usr/bin/env bash
# Create HR upload directories from backend_stub/.env (CloudPanel / production).
set -euo pipefail

API_ROOT="${SHIFTSWIFT_API_ROOT:-/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk}"
SERVICE="${SHIFTSWIFT_SERVICE:-shiftswifthr-api}"
ENV_FILE="${API_ROOT}/backend_stub/.env"

runtime_user="${SHIFTSWIFT_RUNTIME_USER:-}"
if [ -z "${runtime_user}" ] && command -v systemctl >/dev/null 2>&1; then
  runtime_user="$(systemctl show "${SERVICE}" -p User --value 2>/dev/null || true)"
fi
if [ -z "${runtime_user}" ] || [ "${runtime_user}" = "root" ] || [ "${runtime_user}" = "0" ]; then
  runtime_user="shiftswifthr-api"
fi

read_env_path() {
  local key="$1"
  local value=""
  if [ -f "${ENV_FILE}" ]; then
    value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -1 | cut -d= -f2- | sed 's/[[:space:]]#.*//' | tr -d '"' | tr -d "'" | xargs || true)"
  fi
  printf '%s' "${value}"
}

ensure_relative_dir() {
  local raw="$1"
  local path=""
  if [[ "${raw}" = /* ]]; then
    path="${raw}"
  elif [ -n "${raw}" ]; then
    path="${API_ROOT}/backend_stub/${raw}"
  else
    return 0
  fi
  mkdir -p "${path}"
}

ensure_system_dir() {
  local path="$1"
  [ -n "${path}" ] || return 0
  echo "    ${path} (owner ${runtime_user})"
  sudo mkdir -p "${path}"
  sudo chown -R "${runtime_user}:${runtime_user}" "${path}"
  sudo chmod -R u+rwX "${path}"
  parent="$(dirname "${path}")"
  if [ "${parent}" != "${path}" ] && [ -d "${parent}" ]; then
    sudo chown "${runtime_user}:${runtime_user}" "${parent}" 2>/dev/null || true
  fi
}

docs_path="$(read_env_path DOCUMENTS_STORAGE_DIR)"
rtw_path="$(read_env_path RTW_STORAGE_DIR)"
[ -z "${docs_path}" ] && docs_path="uploads/documents"
[ -z "${rtw_path}" ] && rtw_path="uploads/rtw_immutable"

echo "==> ensure upload storage directories (runtime user: ${runtime_user})"

mkdir -p "${API_ROOT}/backend_stub/uploads/documents"
mkdir -p "${API_ROOT}/uploads/documents"
mkdir -p "${API_ROOT}/uploads/rtw_immutable"

if [[ "${docs_path}" = /* ]]; then
  ensure_system_dir "${docs_path}"
else
  ensure_relative_dir "${docs_path}"
fi

if [[ "${rtw_path}" = /* ]]; then
  ensure_system_dir "${rtw_path}"
else
  ensure_relative_dir "${rtw_path}"
fi

# Common /var/lib layout when DOCUMENTS_STORAGE_DIR uses that prefix.
if [[ "${docs_path}" = /var/lib/shiftswift-hr/* ]] || [[ "${rtw_path}" = /var/lib/shiftswift-hr/* ]]; then
  sudo mkdir -p /var/lib/shiftswift-hr/documents /var/lib/shiftswift-hr/rtw
  sudo chown -R "${runtime_user}:${runtime_user}" /var/lib/shiftswift-hr
  sudo chmod -R u+rwX /var/lib/shiftswift-hr
fi
