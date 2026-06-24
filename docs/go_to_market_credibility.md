# Go-to-market credibility — honest self-check

**Purpose:** ShiftSwift HR loses any comparison with Breathe, Charlie HR, or Personio if a prospect Googles us and finds template testimonials, UI mocks presented as live product, or billing that does not work end-to-end. Finish this checklist **before** scaling outbound sales or paid ads.

**Related:** [production_readiness.md](./production_readiness.md) · [b2b_launch_checklist.md](./b2b_launch_checklist.md)

---

## The rule

> Do not sell harder than the product and proof can support.

Trials and demos are fine in early access. Anonymous “HR Manager, Midlands” quotes and aspirational feature claims are not.

---

## Tier 1 — Conversion blockers (do these first)

| # | Item | Why it matters | Status |
|---|------|----------------|--------|
| 1 | **Remove fake social proof** | One Google search kills trust | ✅ Homepage uses early-access copy, not template quotes |
| 2 | **Label UI mocks** | Prospects must know previews are illustrative | ✅ Hero labelled “Product preview · illustrative” |
| 3 | **Stripe live mode E2E** | Trial → paid must work without “email support” | ⚠️ Scaffolded — confirm `sk_live_`, webhook, live Price IDs |
| 4 | **Real product screenshots** | Product showcase on www with pilot placeholders; swap WebP in `frontend/assets/screenshots/` | ⚠️ Placeholders live — redacted captures pending |
| 5 | **First named case study** | Name, role, company type, one metric, permission on file | ❌ Pilot in progress |
| 6 | **Claims match code** | No rota builder, RTI, or payslip portal if not shipped | ✅ Rota/RTI copy corrected on homepage |

---

## Tier 2 — Trust before scale

| # | Item | Notes |
|---|------|-------|
| 7 | Solicitor-reviewed MSA + DPA | Outlines in `docs/` — not signed templates yet |
| 8 | Privacy + payment terms live | Pages exist — confirm solicitor sign-off |
| 9 | SMTP + password reset in prod | Verified on server — keep in deploy checklist |
| 10 | Pilot customer on prod | One friendly business using HR login, employee punch, RTW upload weekly |
| 11 | Backup + restore test | Documented in production_readiness §1 |
| 12 | Uptime monitor on `/health` | Catch outages before customers do |

---

## Tier 3 — When you can sell hard

All of Tier 1 green **plus** at least one of:

- Named case study published (with written permission)
- Stripe live checkout completed by a paying customer (not founder test card)
- Referral from accountant, payroll bureau, or HR consultant — commission manual; see [partner_introducer_policy.md](./partner_introducer_policy.md)

Then: comparison pages vs spreadsheets (not vs Breathe until you have proof), LinkedIn, hospitality forums, sponsor-licence communities.

---

## First case study template

Use when a pilot agrees — keep it short and factual:

1. **Who** — e.g. “Independent pub group, 22 employees, Yorkshire” (or named with permission)
2. **Problem** — sponsor RTW renewals / day-9 tracking / scattered documents
3. **What they use** — employee lifecycle, RTW uploads, audit export, payroll CSV to BrightPay
4. **Outcome** — one number or time saved (only if true)
5. **Quote** — one sentence, their words, signed release
6. **Screenshot** — admin overview or compliance panel (redact names/NI)

Store permission email/PDF in your internal folder — not in git.

---

## Screenshot capture (when pilot is ready)

1. Log into pilot tenant admin on `app.shiftswifthr.co.uk`
2. Capture: Overview, Employee lifecycle, Sponsor compliance, Payroll export, Audit export
3. Redact: names, NI numbers, emails, addresses
4. Replace hero mock panels in `frontend/index.html` with `<img>` or WebP in `frontend/assets/screenshots/`
5. Update alt text: “ShiftSwift HR admin — compliance overview (sample data redacted)”

---

## What we deliberately do **not** claim

| Claim | Reality |
|-------|---------|
| “Trusted by hundreds of…” | No customer count until true |
| Anonymous regional quotes | Removed — use case study or nothing |
| Built-in payroll / RTI | CSV export to BrightPay / Xero only |
| Rota builder | Roadmap — time clock ships today |
| Employee payslip portal | Payslips live in payroll software |

---

## Weekly honest review (5 minutes)

- [ ] Any new marketing copy stronger than the product?
- [ ] Any FAQ answer we would hesitate to say on a demo call?
- [ ] Stripe dashboard: test vs live mode matches what signup promises?
- [ ] One pilot touchpoint this week (call, bug fix, or case study progress)?

---

*Last updated: June 2026*
