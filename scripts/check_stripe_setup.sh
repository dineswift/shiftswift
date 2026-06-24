#!/usr/bin/env bash
# Stripe billing verification — run on the API server before enabling live paid signup.
# Usage: bash scripts/check_stripe_setup.sh [API_BASE_URL]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

API_BASE="${1:-http://127.0.0.1:8000}"
FAIL=0

echo "==> ShiftSwift HR — Stripe setup check"
echo "    $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "    API: ${API_BASE}"
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

echo "==> 1. Core Stripe env vars"
for key in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
  if [ -n "${!key:-}" ]; then
    echo "    OK — ${key} is set"
  else
    echo "    FAIL — ${key} missing"
    FAIL=1
  fi
done

if [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  case "${STRIPE_SECRET_KEY}" in
    sk_live_*) echo "    MODE — live secret key" ;;
    sk_test_*) echo "    WARN — test secret key (expected sk_live_* on production)" ;;
    *) echo "    WARN — unexpected STRIPE_SECRET_KEY prefix" ;;
  esac
fi
echo ""

echo "==> 2. Platform plan Price IDs (billing_config.py)"
REQUIRED_PRICE_ENVS=(
  STRIPE_PRICE_ESSENTIALS_BASE_MONTHLY
  STRIPE_PRICE_ESSENTIALS_SEAT_MONTHLY
  STRIPE_PRICE_COMPLIANCE_BASE_MONTHLY
  STRIPE_PRICE_COMPLIANCE_SEAT_MONTHLY
  STRIPE_PRICE_MULTISITE_BASE_MONTHLY
  STRIPE_PRICE_MULTISITE_SEAT_MONTHLY
)
for key in "${REQUIRED_PRICE_ENVS[@]}"; do
  if [ -n "${!key:-}" ]; then
    echo "    OK — ${key}"
  else
    echo "    FAIL — ${key} missing"
    FAIL=1
  fi
done
echo ""

echo "==> 3. Stripe Tax / currency"
echo "    STRIPE_TAX_ENABLED=${STRIPE_TAX_ENABLED:-not set}"
echo "    STRIPE_CURRENCY=${STRIPE_CURRENCY:-gbp}"
echo ""

echo "==> 4. Billing catalog API (price wiring in app)"
if command -v curl >/dev/null 2>&1; then
  if plans_json="$(curl -sf "${API_BASE}/billing/plans" 2>/dev/null)"; then
    echo "    OK — GET /billing/plans"
    if command -v python3 >/dev/null 2>&1; then
      python3 - <<'PY' "${plans_json}" || FAIL=1
import json, sys
data = json.loads(sys.argv[1])
plans = data.get("platform_plans") or data.get("plans") or []
if not plans:
    print("    FAIL — no platform plans in catalog response")
    raise SystemExit(1)
for plan in plans:
    if plan.get("category") == "payroll":
        continue
    name = plan.get("name") or plan.get("id")
    base_ok = plan.get("stripe_price_configured")
    seat_ok = plan.get("stripe_seat_price_configured")
    if base_ok and seat_ok:
        print(f"    OK — {name}: base + seat Price IDs resolved")
    else:
        print(f"    FAIL — {name}: base={base_ok} seat={seat_ok}")
        raise SystemExit(1)
print(f"    stripe_configured={data.get('stripe_configured')}")
PY
    fi
  else
    echo "    FAIL — could not reach ${API_BASE}/billing/plans"
    FAIL=1
  fi
else
  echo "    SKIP — curl not available"
fi
echo ""

echo "==> 5. Stripe API — validate Price IDs (optional)"
PY="${ROOT}/backend_stub/.venv/bin/python"
if [ -x "${PY}" ] && [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  "${PY}" - <<'PY' || FAIL=1
import os, sys
try:
    import stripe
except ImportError:
    print("    SKIP — stripe package not installed in venv")
    sys.exit(0)

keys = [
    "STRIPE_PRICE_ESSENTIALS_BASE_MONTHLY",
    "STRIPE_PRICE_ESSENTIALS_SEAT_MONTHLY",
    "STRIPE_PRICE_COMPLIANCE_BASE_MONTHLY",
    "STRIPE_PRICE_COMPLIANCE_SEAT_MONTHLY",
    "STRIPE_PRICE_MULTISITE_BASE_MONTHLY",
    "STRIPE_PRICE_MULTISITE_SEAT_MONTHLY",
]
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
for env_key in keys:
    price_id = os.getenv(env_key, "").strip()
    if not price_id:
        print(f"    FAIL — {env_key} empty")
        sys.exit(1)
    try:
        price = stripe.Price.retrieve(price_id)
        active = price.get("active")
        recurring = (price.get("recurring") or {}).get("interval", "?")
        amount = price.get("unit_amount")
        print(f"    OK — {env_key} → {price_id} active={active} interval={recurring} unit_amount={amount}")
    except Exception as exc:
        print(f"    FAIL — {env_key} → {price_id}: {exc}")
        sys.exit(1)
PY
else
  echo "    SKIP — venv python or STRIPE_SECRET_KEY not available"
fi
echo ""

echo "==> 6. Webhook endpoint (manual)"
echo "    Dashboard → Developers → Webhooks → https://api.shiftswifthr.co.uk/billing/webhook"
echo "    Events: checkout.session.completed, customer.subscription.updated,"
echo "            customer.subscription.deleted, invoice.paid, invoice.payment_failed"
echo ""

echo "==> 7. End-to-end trial (manual)"
echo "    [ ] Signup on app.shiftswifthr.co.uk — no card for trial"
echo "    [ ] Add 2+ employees → seat sync updates Stripe quantity"
echo "    [ ] Upgrade to paid plan → Checkout completes in live mode"
echo "    [ ] Webhook log shows checkout.session.completed"
echo ""

if [ "${FAIL}" -ne 0 ]; then
  echo "RESULT: FAIL — fix items above before live paid billing"
  echo "See docs/stripe_env_verification_checklist.md"
  exit 1
fi

echo "RESULT: PASS — env + catalog checks OK (complete manual steps 6–7 before launch)"
echo "See docs/stripe_env_verification_checklist.md"
