#!/usr/bin/env bash
# Promote MFA-skip frontend assets over the canonical login scripts.
# Run from Terminal if macOS TCC blocks the agent from writing login.js / unified-login.js.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cp "$ROOT/frontend/login-mfa-skip.js" "$ROOT/frontend/login.js"
cp "$ROOT/frontend/unified-login-mfa-skip.js" "$ROOT/frontend/unified-login.js"

echo "Updated frontend/login.js and frontend/unified-login.js with MFA enrollment skip support."
echo "Backend route: POST /auth/mfa/skip-enrollment (auth_mfa_skip_enrollment.py, attached via modules/master/routes.py)."
