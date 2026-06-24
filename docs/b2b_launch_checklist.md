# ShiftSwift HR — B2B launch checklist

Map your isolated HR platform requirements to project status. Legal text below is **outline only** — have a UK solicitor review before publishing.

## 1. Corporate Stripe B2B billing

| Item | Status | Notes |
|------|--------|-------|
| Stripe Billing subscriptions | **Scaffolded** | `GET /billing/plans`, `POST /billing/checkout-session`, `POST /billing/webhook` |
| Stripe Tax (20% UK VAT) | **Config ready** | Set `STRIPE_TAX_ENABLED=1`; enable in Stripe Dashboard |
| VAT number collection | **Scaffolded** | Checkout uses `tax_id_collection`; store on `tenants.vat_number` |
| B2B refund policy published | **Draft** | See `docs/b2b_payment_terms.md` |
| Recurring invoices to clients | **Stripe-side** | Enable Customer Portal + invoice emails in Stripe |

**Env vars:** see `backend_stub/.env.example` (`STRIPE_SECRET_KEY`, price IDs, webhook secret).

**Go-live:** see [production_readiness.md](./production_readiness.md) and [server_installation.md](./server_installation.md).

## 2. Isolated legal frameworks

| Item | Status | Notes |
|------|--------|-------|
| HR-specific MSA | **Outline** | `docs/hr_msa_outline.md` |
| HR DPA with data silo clause | **Outline** | `docs/hr_dpa_outline.md` |
| Separate from EPOS terms | **Required copy** | MSA must state HR is a distinct service with separate SLA |
| EULA (sponsor module) | **Done** | `docs/eula_hr_module.md` |

## 3. B2B data security controls

| Item | Status | Notes |
|------|--------|-------|
| Tenant data isolation | **Partial** | JWT + `X-Tenant-Id` checks; migration `023` adds tenant billing columns |
| RBAC (GM vs supervisor vs HR) | **Scaffolded** | `backend_stub/rbac.py` + `tenant_users` table |
| Immutable employee audit log | **Scaffolded** | `employee_data_audit_log` + `employee_audit.py` |
| Security login audit | **Done** | `security_audit_events` |
| Compliance audit | **Done** | `compliance_audit_events` |
| Cyber Essentials software controls | **Done** | `docs/cyber_essentials_readiness.md` |

## 4. Database isolation from EPOS

| Item | Status | Notes |
|------|--------|-------|
| Separate HR database | **Architecture** | This repo is HR-only; `tenants.platform = 'hr'` |
| No EPOS/order/card data | **By design** | No PCI scope in HR DB |
| DPA states logical segregation | **Draft** | `docs/hr_dpa_outline.md` |

---

## Launch order (recommended)

1. Run all pending migrations (`bash scripts/run_migrations.sh`) — current head: `088_employee_profile_change_requests.sql`
2. Create Stripe Products/Prices; set env vars
3. Enable Stripe Tax; test checkout with a test VAT number
4. Solicitor review: MSA, DPA, payment terms
5. Wire employee CRUD to `log_employee_data_event()` when full HR module is restored
6. Publish privacy notice + payment terms on marketing site
