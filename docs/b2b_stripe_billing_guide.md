# B2B Stripe billing — ShiftSwift HR

## Recommended pricing model (2026)

**Base fee + per active employee, hard monthly cap.** Managers and HR logins are free — only active employees on payroll count.

| Plan | Base (ex VAT) | Per active employee | Monthly cap | Best for |
|------|---------------|---------------------|-------------|----------|
| **Essentials** | £9 | £2 | £49 | Small sites — records, RTW, time clock, payroll export |
| **Compliance** | £19 | £3 | £79 | Hospitality & sponsors — day-9 alerts, audit export |
| **Multi-site** | £29 | £2 | £129 | Groups — consolidated compliance, API |

**Examples (Compliance, ex VAT):**

| Active employees | Bill |
|------------------|------|
| 5 | £34 |
| 10 | £49 |
| 20 | £79 (cap) |

VAT at 20% is added at checkout via **Stripe Tax** when `STRIPE_TAX_ENABLED=1`.

### Product story (one sentence)

> UK compliance HR for sponsored workers — fair per-head pricing, geofenced clock-in for day-9 alerts, works with your existing payroll (BrightPay / Xero).

Configured in `backend_stub/billing_config.py` and seeded to `subscription_plans` via `scripts/seed_billing_catalog.py`.

---

## Stripe Dashboard setup (per-head)

Each plan needs **two recurring GBP Prices** on one Product (or separate Products):

1. **Base** — fixed monthly amount (£9 / £19 / £29)
2. **Seat** — per-unit monthly amount (£2 / £3 / £2) — subscription item `quantity` = active employee count

### Create Products / Prices

| Product | Price type | Amount | Env var |
|---------|------------|--------|---------|
| ShiftSwift HR Essentials | Recurring fixed | £9/mo | `STRIPE_PRICE_ESSENTIALS_BASE_MONTHLY` |
| Essentials seat | Recurring per unit | £2/mo | `STRIPE_PRICE_ESSENTIALS_SEAT_MONTHLY` |
| ShiftSwift HR Compliance | Recurring fixed | £19/mo | `STRIPE_PRICE_COMPLIANCE_BASE_MONTHLY` |
| Compliance seat | Recurring per unit | £3/mo | `STRIPE_PRICE_COMPLIANCE_SEAT_MONTHLY` |
| ShiftSwift HR Multi-site | Recurring fixed | £29/mo | `STRIPE_PRICE_MULTISITE_BASE_MONTHLY` |
| Multi-site seat | Recurring per unit | £2/mo | `STRIPE_PRICE_MULTISITE_SEAT_MONTHLY` |

**Monthly cap:** enforced in application logic when syncing seat quantity via `billing_seat_sync.py` (wired from employee lifecycle updates).

### Signup subscription items

On registration, `billing_stripe_service.provision_tenant_billing()` creates:

```python
items = [
  {"price": base_price_id, "quantity": 1},
  {"price": seat_price_id, "quantity": 1},  # bump when employees added
]
```

---

## Environment variables

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_TAX_ENABLED=1
STRIPE_CURRENCY=gbp
STRIPE_PAYMENT_METHODS=bacs_debit,card

STRIPE_PRICE_ESSENTIALS_BASE_MONTHLY=price_...
STRIPE_PRICE_ESSENTIALS_SEAT_MONTHLY=price_...
STRIPE_PRICE_COMPLIANCE_BASE_MONTHLY=price_...
STRIPE_PRICE_COMPLIANCE_SEAT_MONTHLY=price_...
STRIPE_PRICE_MULTISITE_BASE_MONTHLY=price_...
STRIPE_PRICE_MULTISITE_SEAT_MONTHLY=price_...
```

Run migration `041_per_head_billing.sql`, then:

```bash
python3 scripts/seed_billing_catalog.py
```

---

## Editable plans (SQL)

```sql
UPDATE subscription_plans
SET base_price_gbp_ex_vat = 19,
    price_per_active_employee_gbp_ex_vat = 3,
    monthly_cap_gbp_ex_vat = 79
WHERE id = 'site_medium_monthly';
```

Marketing and `/billing/plans` read from DB when seeded.

---

## Payroll

ShiftSwift HR **does not bill for payroll processing**. BrightPay / Xero export is included on all plans. Legacy `payroll_plans` table and env vars are deprecated.

---

## API usage

```bash
curl http://localhost:3000/billing/plans
```

Each platform plan includes `billing_model`, `base_price_gbp_ex_vat`, `price_per_active_employee_gbp_ex_vat`, `monthly_cap_gbp_ex_vat`, and `example_quotes`.

---

## UK Direct Debit (Bacs) via Stripe

Unchanged — see previous guide section. Collect mandate at signup via Checkout setup mode.

---

## Discount codes

| Code | Effect |
|------|--------|
| `LAUNCH20` | 20% off |
| `CAFE10` | 10% off Essentials |
| `WELCOME5` | £5 off |
| `REF-PUB` | 15% off customer (referral) — introducer commission paid **manually**; see [partner_introducer_policy.md](./partner_introducer_policy.md) |

Discounts apply to platform subscription; seat line may need matching coupons in Stripe if you discount both components.

---

## Webhooks

Endpoint: `https://api.shiftswifthr.co.uk/billing/webhook`

Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

---

## Before live per-head billing

1. ~~**Seat quantity sync**~~ — **Done** (`billing_seat_sync.py`); verify on staging after employee add/remove
2. **Stripe live Prices** — create all six Price IDs above in Dashboard + `.env`
3. **End-to-end test** — signup → add employees → invoice matches quote

*Legacy flat per-site (£29/£59/£99) and annual plans are retired from marketing; existing tenants on old plan IDs remain supported until migrated.*
