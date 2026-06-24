# Stripe env verification checklist

Run on the **API server** after updating `backend_stub/.env` and before turning on live paid signup.

```bash
cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
bash scripts/check_stripe_setup.sh https://api.shiftswifthr.co.uk
```

Local:

```bash
bash scripts/check_stripe_setup.sh http://127.0.0.1:8000
```

---

## 1. Create Stripe Prices (Dashboard)

Create **six recurring GBP prices** (ex VAT — Stripe Tax adds VAT when enabled):

| Plan | Type | Amount | Env var |
|------|------|--------|---------|
| Essentials base | Fixed monthly | £9 | `STRIPE_PRICE_ESSENTIALS_BASE_MONTHLY` |
| Essentials seat | Per unit monthly | £2 | `STRIPE_PRICE_ESSENTIALS_SEAT_MONTHLY` |
| Compliance base | Fixed monthly | £19 | `STRIPE_PRICE_COMPLIANCE_BASE_MONTHLY` |
| Compliance seat | Per unit monthly | £3 | `STRIPE_PRICE_COMPLIANCE_SEAT_MONTHLY` |
| Multi-site base | Fixed monthly | £29 | `STRIPE_PRICE_MULTISITE_BASE_MONTHLY` |
| Multi-site seat | Per unit monthly | £2 | `STRIPE_PRICE_MULTISITE_SEAT_MONTHLY` |

Copy each `price_…` ID into `backend_stub/.env`. Reference: `backend_stub/billing_config.py`.

**Retired names** (`STRIPE_PRICE_SITE_STARTER_*`, etc.) are no longer used by the app.

---

## 2. Required env vars

```env
STRIPE_SECRET_KEY=sk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_TAX_ENABLED=1
STRIPE_CURRENCY=gbp
STRIPE_PRICE_ESSENTIALS_BASE_MONTHLY=price_…
STRIPE_PRICE_ESSENTIALS_SEAT_MONTHLY=price_…
STRIPE_PRICE_COMPLIANCE_BASE_MONTHLY=price_…
STRIPE_PRICE_COMPLIANCE_SEAT_MONTHLY=price_…
STRIPE_PRICE_MULTISITE_BASE_MONTHLY=price_…
STRIPE_PRICE_MULTISITE_SEAT_MONTHLY=price_…
```

Restart API after changes:

```bash
sudo systemctl restart shiftswifthr-api
```

---

## 3. Automated checks (`check_stripe_setup.sh`)

| Step | What it verifies |
|------|------------------|
| 1 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` present; live vs test key |
| 2 | All six platform Price ID env vars set |
| 3 | Tax / currency flags |
| 4 | `GET /billing/plans` — each plan has `stripe_price_configured` + `stripe_seat_price_configured` |
| 5 | Stripe API `Price.retrieve` for each ID (active, recurring) |
| 6–7 | Manual webhook + E2E (see below) |

---

## 4. Webhook (manual)

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://api.shiftswifthr.co.uk/billing/webhook`
3. Events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET`
5. Send test event → API logs should show `200`

---

## 5. End-to-end live test (manual)

- [ ] New signup → **14-day trial**, no card required
- [ ] Add employees → Stripe subscription item quantity syncs (`billing_seat_sync.py`)
- [ ] Monthly cap respected on invoice quote vs in-app calculator
- [ ] Upgrade to Compliance → Checkout completes (`sk_live_`)
- [ ] Webhook delivers `checkout.session.completed`
- [ ] Billing email receives invoice/receipt
- [ ] Cancel at period end → access until period ends

---

## 6. Rollback

- Switch Dashboard to **test mode** only for staging — never mix test keys on production `.env`
- Keep previous `price_` IDs in a secure note until first live tenant is stable
- OPS master can set tenant to offline billing if Stripe incident (`tenants.billing_mode`)

---

## Related docs

- `docs/b2b_stripe_billing_guide.md` — pricing model
- `docs/b2b_launch_checklist.md` — broader B2B launch
- `docs/production_readiness.md` — full go-live blockers

*Last updated: June 2026*
