# ShiftSwift HR — compliance checklist (operator)

**For:** Datasoftware Analytics Ltd (ShiftSwift HR)  
**Last updated:** 7 September 2026  
**Not legal advice** — use with a UK solicitor specialising in SaaS and employment data.

---

## How to use this page

Work through each section. Mark **Done**, **In progress**, or **N/A**. Revisit quarterly and after any major product change (new data type, new sub-processor, new market).

---

## 1. ICO & UK GDPR (foundation)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | ICO registration live and fee paid | ☐ | Renew annually; update entry if processing changes |
| 1.2 | Privacy policy published and dated | ☐ | `frontend/privacy-policy.html` — includes GPS / Time Clock |
| 1.3 | Cookie policy + consent banner live | ☐ | `cookies.html` + `cookie-consent.js` on public pages |
| 1.4 | Record of Processing Activities (ROPA) written | ☐ | Internal doc: what, why, lawful basis, retention, recipients |
| 1.5 | Data breach playbook (72h to customers) | ☐ | Who decides, who emails, template notification |
| 1.6 | SAR / erasure process documented | ☐ | `legal@datasoftwareanalytics.co.uk` + public page `frontend/delete-account.html` |
| 1.7 | Customer offboarding: export + delete runbook | ☐ | Align with DPA § deletion (30–90 days) |

---

## 2. Customer contracts (B2B)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | MSA reviewed by UK solicitor | ☐ | Outline: `docs/hr_msa_outline.md` |
| 2.2 | DPA reviewed and signed per customer | ☐ | Outline: `docs/hr_dpa_outline.md` / `dpa.html` |
| 2.3 | Sub-processor list maintained | ☐ | Hosting, email (Brevo), Stripe, geocoding if used |
| 2.4 | Payment / refund terms published | ☐ | `payment-terms.html` |
| 2.5 | Marketing claims match product | ☐ | No “solicitor-reviewed” until true; see `go_to_market_credibility.md` |

---

## 3. Employee & HR data (processor role)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Tell customers they need an **employee privacy notice** | ☐ | Employer is controller; must mention HR system + GPS punch |
| 3.2 | Time Clock GPS described in privacy policy + DPA | ☐ | Lat/lng, accuracy, distance, geofence purpose |
| 3.3 | RTW / sponsor documents backed up with DB | ☐ | `RTW_STORAGE_DIR` in backup plan |
| 3.4 | Grievance encryption key (`ENCRYPTION_KEY`) in prod | ☐ | Required for encrypted notes |
| 3.5 | Audit logs enabled for employee data changes | ☐ | `employee_data_audit_log` |
| 3.6 | DPIA considered for GPS + immigration data | ☐ | Recommended before scale |

---

## 4. Security & operations

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | HTTPS everywhere (`FORCE_HTTPS=1`) | ☐ | www, app, api |
| 4.2 | Strong secrets rotated (`JWT_SECRET`, `ENCRYPTION_KEY`) | ☐ | `scripts/generate_secrets.sh` |
| 4.3 | Daily Postgres backups + tested restore | ☐ | Document in `production_readiness.md` |
| 4.4 | Uptime monitor on `/health` | ☐ | |
| 4.5 | `bash scripts/security_audit.sh` monthly | ☐ | pip audit + config checks |
| 4.6 | MFA on company email / cloud admin | ☐ | Organisational control for Cyber Essentials |
| 4.7 | Cyber Essentials (optional certification) | ☐ | `docs/cyber_essentials_readiness.md` |

---

## 5. PECR & marketing

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Cookie banner before non-essential cookies | ☐ | Essential-only default path available |
| 5.2 | B2B email outreach has lawful basis + unsubscribe | ☐ | Legitimate interest or consent — document choice |
| 5.3 | No analytics pixels until consent mechanism ready | ☐ | Banner supports future analytics |

---

## 6. Insurance & company admin

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Professional indemnity insurance | ☐ | Recommended for HR SaaS |
| 6.2 | Cyber insurance | ☐ | Recommended |
| 6.3 | Companies House filings current | ☐ | Co. 14568900 |
| 6.4 | HMRC / VAT compliance | ☐ | If registered |

---

## 7. What you do **not** need (for this product today)

| Item | Why |
|------|-----|
| Home Office registration | Software vendor — sponsor duties stay with the employer |
| FCA authorisation | Not providing financial services |
| PCI DSS full scope | Stripe handles card data; you store metadata only |
| Separate “software compliance register” | No such UK registry exists |

---

## 8. Quick links

| Document | Path |
|----------|------|
| Privacy policy | `frontend/privacy-policy.html` |
| Account / data deletion | `frontend/delete-account.html` (`https://www.shiftswifthr.co.uk/delete-account.html`) |
| Cookie policy | `frontend/cookies.html` |
| DPA outline | `frontend/dpa.html` |
| Production readiness | `docs/production_readiness.md` |
| Compliance checklist (web) | `frontend/compliance-checklist.html` |
| Cyber Essentials prep | `docs/cyber_essentials_readiness.md` |
| Go-to-market honesty | `docs/go_to_market_credibility.md` |

---

## 9. Contacts

- **Privacy / legal:** legal@datasoftwareanalytics.co.uk  
- **Product support:** support@shiftswifthr.co.uk  
- **ICO complaints (data subjects):** https://ico.org.uk

---

*Review this checklist with your solicitor before relying on it for regulatory or sales purposes.*
