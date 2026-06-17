# ShiftSwift HR — strategy backlog

**Source:** `ShiftSwift_HR_Strategy_Copy.docx` (repo root / Desktop copy)  
**Legal entity:** Datasoftware Analytics Ltd (Co. 14568900) · trading as **ShiftSwift HR**  
**Last synced from strategy doc:** 2026-06-09

Use this file as the **working note** — the docx stays the copy/design source; this file tracks **what to build, where in code, and priority**.

---

## How to work from the strategy (recommended)

1. **Keep one copy source** — edit marketing text in the docx (or export to this repo as `docs/shiftswift_hr_website_copy.md` when copy stabilises).
2. **Track delivery here** — each row = one PR-sized task with owner and status.
3. **Work in four lanes** (do not mix in one PR):
   - **Lane A — Marketing site** (`frontend/index.html`, `landing.css`, `pricing.js`)
   - **Lane B — Product / admin** (`frontend/admin*.js`, `backend_stub/modules/*`)
   - **Lane C — Billing & plans** (`billing_config.py`, `seed_billing_catalog.py`, Stripe)
   - **Lane D — Legal & trust** (`brand-config.js`, footers, `contract_templates/`, `/docs/*`)
4. **Ship in order:** D (legal/footer) → A (copy + pricing display) → C (Stripe prices match strategy) → B (feature gaps).

---

## Lane D — Legal & footer (mostly done)

| Item | Strategy requirement | Code / status |
|------|---------------------|---------------|
| Trading name footer | Full block with Co. 14568900 + address | `frontend/index.html` — **partial** (update to match docx verbatim incl. `legal@datasoftwareanalytics.co.uk`) |
| Provider on contracts | Datasoftware Analytics Ltd trading as ShiftSwift HR | `contracts_service.py`, templates — **done** |
| Privacy / cookies URLs | `/docs/privacy-policy`, `/docs/cookies` | **Done** — `docs/privacy-policy.md`, `docs/cookies.md` + footer links |
| DineSwift footer parity | Same parent, different product email | Separate site — not in this repo |

**Docx footer (ShiftSwift HR — use verbatim on www):**

```
ShiftSwift HR is a trading name of Datasoftware Analytics Ltd
Registered in England & Wales · Company No. 14568900
235 Charlbury Road, Nottingham, NG8 1NF
support@shiftswifthr.co.uk · legal@datasoftwareanalytics.co.uk
© 2026 Datasoftware Analytics Ltd. All rights reserved.
```

---

## Lane A — Website copy (Section 2 of strategy)

| Section | Strategy headline / intent | File | Status |
|---------|---------------------------|------|--------|
| Meta title | UK HR Software for SMEs & Sponsor Licence Holders | `index.html` `<title>` + meta description | **TODO** |
| Hero | “HR software that keeps you compliant…” | `index.html` hero | **Review** — align exact copy |
| Trust strip | GDPR · UK-hosted · RTI · audit exports · cancel anytime | trust strip | **Partial** |
| Social proof | Early-access honesty block (no template quotes) | `index.html` | **Done** — add named case study when pilot completes |
| Features | 6 cards (RTW, sponsor, payroll add-on, rota, lifecycle, audit export) | features section | **Review** |
| Comparison table | Spreadsheets vs ShiftSwift HR | `index.html` + `docs/competitive_comparison.md` | **Done** — spreadsheets table + competitor matrix (Breathe, Rotacloud) |
| FAQ | 7 questions from strategy (RTI add-on, trial no card, payroll later, sponsor, UK data, cancel, multi-site) | `index.html` / FAQ | **TODO** — fix dev-facing Stripe answer |
| Screenshots | RTW dashboard, rota, audit export | `assets/` | **TODO** — need real UI captures |
| Pricing page copy | “Simple, predictable pricing…” + VAT note | `pricing.js` + `index.html` | **TODO** |

**Brand tone reminder (ShiftSwift HR):** calm, authoritative, reassuring — compliance, records, alerts, peace of mind. Not DineSwift’s revenue/growth voice.

---

## Lane C — Pricing architecture (Section 3)

Strategy tiers (per **site**, ex VAT):

| Plan | Price/mo | Staff cap | Key unlocks |
|------|----------|-----------|-------------|
| Plan | Pricing | Cap | Highlights |
|------|---------|-----|------------|
| Essentials | £9 + £2/active employee | £49/mo | Records, RTW, **geofenced time clock**, payroll export |
| Compliance | £19 + £3/active employee | £79/mo | + Day-9 (clock-linked), sponsor compliance, audit export |
| Multi-site | £29 + £2/active employee | £129/mo | + Multi-site dashboard, API |
| Enterprise | Custom | 100+ | SLA, procurement |

**Annual:** 2 months free (~17%) — show savings prominently.

**Payroll add-on (separate):** £19 / £35 / £55 / £85 by headcount bands.

| Task | Where | Status |
|------|-------|--------|
| Align DB plan catalog with strategy names/prices | `scripts/seed_billing_catalog.py`, `billing_config.py` | **Review** — current IDs like `site_medium_monthly` may not match Starter/Growth/Scale |
| Feature gates per tier | `plan_features.py`, `admin_service.py`, `admin-shared.js` | **Done** — Growth: sponsor, grievance, audit export; Scale: multi-site, API |
| Stripe Price IDs | `.env` + `subscription_plans` table | **TODO on server** — create in Stripe Dashboard; env vars documented |

---

## Lane B — Product vs strategy promises

What the strategy **claims** vs what the **app already has**:

| Capability | Strategy | Product today | Gap |
|------------|----------|---------------|-----|
| Right to work | Upload, expiry alerts, audit trail | Sponsor compliance + RTW modules | Polish UX + marketing screenshots |
| Day-9 alerts | Automatic sponsor absence | `sponsor_licence_compliance.py`, jobs | **Built** — ensure on Growth plan gate |
| HMRC RTI / payroll | Payroll add-on | Payroll module / export | Verify RTI wording vs actual Stripe add-on |
| Rota builder | Drag-and-drop | Check if rota exists or roadmap | **Clarify** — may be aspirational |
| Employee lifecycle | Offer → leaver | `admin-employees.js` 10-step flow | **Built** — accordion UI recently updated |
| Audit export | One-click Home Office pack | `audit_export.py` | **Built** — gated to Growth+ |
| Multi-site dashboard | Scale plan | Settings panel + plan gate | **Partial** — contact support to add sites |
| Grievance | Growth plan | `admin-grievance.js` | **Built** — gated to Growth+ |
| API access | Scale plan | Settings panel + plan gate | **Partial** — keys issued on Scale activation |

---

## Immediate fix list (from strategy doc — do first)

- [x] **Pricing table visible** on www with Starter / Growth / Scale + payroll bands
- [x] **FAQ:** trial without card copy (removed dev Stripe message)
- [x] **Footer** — full trading-name block
- [x] **Social proof** — early-access honesty (no template quotes until real case study)
- [x] **Hero meta** title + description from strategy
- [x] **Screenshots** — product showcase section with UI mocks (replace with real captures when ready)
- [x] **Signup page** — strategy copy + legal footer
- [x] **Deploy script** — `pull-production.sh` runs `seed_billing_catalog.py`

---

## Suggested sprint order

### Sprint 1 — Trust & conversion (1–2 days)
Footer, meta tags, FAQ rewrite, pricing table UI (can use strategy prices before Stripe sync).

### Sprint 2 — Billing truth (2–3 days)
Seed plans, Stripe prices, feature gates for Growth/Scale, annual discount display.

### Sprint 3 — Proof & polish (2–3 days)
Screenshots, comparison table, social proof, deploy to www + app.

### Sprint 4 — Product gaps (ongoing)
Multi-site dashboard, rota attendance exports, API docs for Scale tier.

**Sprint 4 status (June 2026):** Rota attendance timezone + export done; pilot QA script + checklist expanded; manual sign-off pending on production.

---

## References in codebase

| Area | Path |
|------|------|
| Marketing home | `frontend/index.html`, `frontend/landing.css` |
| Pricing | `frontend/pricing.js`, `frontend/pricing.css` |
| Brand defaults | `frontend/brand-config.js`, `backend_stub/brand.py` |
| Plans / billing | `backend_stub/billing_config.py`, `scripts/seed_billing_catalog.py` |
| Admin product | `frontend/admin.html`, `frontend/admin-*.js` |
| Compliance | `backend_stub/sponsor_licence_compliance.py`, `frontend/admin-compliance.js` |
| Competitive one-pager | `docs/competitive_comparison.md` |
| Legal templates | `backend_stub/contract_templates/`, `docs/legal_contracts.md` |

---

## Notes

- **Do not** paste DineSwift copy onto ShiftSwift HR — different tone and buyer fear.
- **Payroll export** (not in-app RTI) in messaging; HR-only trial is valid.
- When a pilot completes, publish one named case study with permission — see `docs/go_to_market_credibility.md`.
- After each website change: `git push` → `pull-production.sh` on server → hard-refresh www/app.
