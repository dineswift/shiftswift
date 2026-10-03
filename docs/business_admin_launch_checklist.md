# ShiftSwift HR — Business Admin launch checklist

Prioritized improvements for the **HR Admin portal** (`admin.html` + `admin-*.js`).  
Use alongside [launch_day_checklist.md](./launch_day_checklist.md) and [production_readiness.md](./production_readiness.md).

**Current honest scores (pre-checklist):** Function 8/10 · Design 7/10 · Working 7/10 · **~7.5/10 overall**

**Target after P0 + P1:** Function 9/10 · Design 8.5/10 · Working 8.5/10 · **~9/10 overall**

---

## How to use this doc

| Priority | Meaning | When |
|----------|---------|------|
| **P0** | Blocks pilot customers or causes data/support incidents | Before next paying / live customer |
| **P1** | Noticeable UX or reliability gaps; fix within first 30 days | Soft launch → paid launch |
| **P2** | Polish, maintainability, competitive edge | Post-launch roadmap |

**Effort key:** S = hours · M = 1–2 days · L = 3–5 days · XL = 1+ week

---

## P0 — Must fix before live customers

### P0.1 Deploy & data layer (server)

| # | Task | Files / commands | Effort |
|---|------|------------------|--------|
| 1 | Run migrations **089–091** on production (document signing, rota snapshot, MFA trusted devices) | `migrations/089_*.sql` … `091_*.sql`, `scripts/run_migrations.sh` | S |
| 2 | Deploy latest API + frontend after each release | `deploy/cloudpanel/pull-production.sh`, `deploy/cloudpanel/sync-frontend-only.sh` | S |
| 3 | Verify health + auth endpoints | `curl https://api.shiftswifthr.co.uk/health` | S |
| 4 | Confirm `qrcode[pil]` installed on server (premises QR PNG) | `backend_stub/requirements.txt`, `modules/time_punch/qr.py` | S |

**Verify:** Time punch → Premises QR → Download PNG works on production (not only localhost).

---

### P0.2 Auth & session (web + native)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 5 | Unified login: one screen, no business-login loop after MFA | `unified-login.js`, `session-auth.js`, `admin-shared.js`, `sign-in.html` | Done — verify on device |
| 6 | Native session persists login → `admin.html` | `session-auth.js` (`persistNativeSession`, Preferences) | Done — verify cross-origin |
| 7 | Session expiry redirects to unified login, not `business-login.html` | `admin-shared.js` `resolveLoginUrl()`, `auth-guard.js` | Done — verify 401 on admin |
| 8 | Hard-refresh cache bust after deploy | Bump `?v=` on `session-auth.js`, `admin-shared.js` in `admin.html` | S |

**Verify:** Sign in on iOS app → HR admin → sign out → sign in again → MFA only when expected (trusted device).

---

### P0.3 Core daily workflows (manual smoke — 45 min)

Run on **production** with a real tenant (e.g. Himalayan Inn):

| # | Flow | Section | Pass? |
|---|------|---------|-------|
| 9 | Add / edit employee, open document store, upload payslip | `#employees` · `admin-employees.js` | ☐ |
| 10 | Settings → Document store → upload + distribute (form keeps defaults) | `admin-documents.js` | ☐ |
| 11 | Sync punch site → download QR → print card | `admin-time-punch.js` | ☐ |
| 12 | Build rota week → publish → employee sees shifts | `admin-rota.js` · `employee-rota.js` | ☐ |
| 13 | Employee clocks in (GPS or premises QR) → appears in punch log | `employee-time-punch.js` | ☐ |
| 14 | Approve leave request | `admin-leave.js` | ☐ |
| 15 | Export hours CSV/PDF for accountant | `admin-time-punch.js` | ☐ |

**If any fail:** treat as P0 blocker until fixed.

---

### P0.4 Error messages customers actually see

| # | Task | Files | Effort |
|---|------|-------|--------|
| 16 | Replace “Load failed” with actionable copy where missing | `admin-shared.js` `friendlyNativeError`, `admin-documents.js` `friendlyError`, `admin-time-punch.js` `friendlyQrDownloadError` | S (partially done) |
| 17 | Overview shows retry when API unreachable | `admin-workspace.js` | Done — verify |
| 18 | Document list failure shows banner + retry, not silent empty | `admin-documents.js` `setDocumentsPanelAlert` | Done — verify |

---

## P1 — First 30 days (reach ~9/10)

### P1.1 Unified feedback (no `alert()`)

**Problem:** ~46 `alert()` calls across admin modules feel broken on mobile and bypass toasts.

**Status:** Done — zero `alert(` in `frontend/admin-*.js` (destructive actions still use `confirm()`).

| Module | Status | File |
|--------|--------|------|
| CRM | Done | `admin-crm.js` |
| Offboarding | Done | `admin-offboarding.js` |
| Recruitment | Done | `admin-recruitment.js` |
| Employees | Done | `admin-employees.js` |
| Grievance / disciplinary / templates / promotions / workspace / documents | Done | respective `admin-*.js` |

| # | Task | Approach | Effort |
|---|------|----------|--------|
| 19 | Add `Admin.showAdminToast` helper wrapper for errors | `admin-shared.js` | Done |
| 20 | Replace CRM alerts (highest count) | `admin-crm.js` | Done |
| 21 | Replace offboarding + recruitment alerts | `admin-offboarding.js`, `admin-recruitment.js` | Done |
| 22 | Replace remaining admin alerts | all `admin-*.js` grep `alert(` | Done |

---

### P1.2 Discoverability & settings honesty

| # | Task | Files | Effort |
|---|------|-------|--------|
| 23 | Add **Payroll export** callout on Overview or Time punch tab (hours CSV/PDF lives here) | `admin-workspace.js`, `admin.html` time-punch intro | S |
| 24 | Remove or replace “Self-service enablement is coming soon” with real toggle **or** honest “Contact support to enable” CTA | `admin-settings.js` ~534, add-ons panel | M |
| 25 | Wire add-on enable to billing API where backend supports it | `admin-settings.js`, `backend_stub` billing routes | L |
| 26 | Settings hub: don’t reset document upload form on re-entry | `admin-settings.js`, `admin-documents.js` | Done — verify |

---

### P1.3 Mobile admin polish

| # | Task | Files | Effort |
|---|------|-------|--------|
| 27 | Align breakpoints (860 vs 980px) | `admin-mobile-polish.css`, `admin-settings.js` `isMobileSettingsLayout` | S |
| 28 | Time punch + rota: sticky action bar on small screens | `admin-mobile-polish.css`, section markup in `admin.html` | M |
| 29 | Tables: ensure `mobile-tables.js` on all wide admin tables | `admin.html` script includes | S |

**Verify on iPhone:** Modules tab → Employees → Rota week → Time punch QR.

---

### P1.4 PWA / offline clarity

| # | Task | Files | Effort |
|---|------|-------|--------|
| 30 | Expand `admin-sw.js` SHELL to include heavy modules OR show “Connection required” banner when offline | `admin-sw.js`, `admin-workspace.js` | M |
| 31 | Bump `CACHE_NAME` after each admin JS deploy | `admin-sw.js` | S |

**Recommendation:** Prefer **connection banner** over full offline admin (HR data should not stale-cache).

---

### P1.5 Automated smoke tests (working score → 9)

| # | Task | Scope | Effort |
|---|------|-------|--------|
| 32 | Playwright: business login → overview loads | `e2e/tests/admin-smoke.spec.ts` | Done |
| 33 | Playwright: employees hash + settings documents | same | Done |
| 34 | CI job on PR: run e2e against `backend_stub` + static frontend | `.github/workflows/admin-e2e-smoke.yml`, `scripts/run_e2e_ci.sh` | Done |

**Run locally:** `bash scripts/start_local.sh` then `bash scripts/run_e2e_smoke.sh` (or `bash scripts/run_e2e_ci.sh` for no-DB CI-style run).

---

## P2 — Post-launch roadmap (10/10 polish)

### P2.1 Architecture & performance

| # | Task | Files | Effort |
|---|------|-------|--------|
| 35 | Split `admin.html` into section partials or lazy-loaded templates | `admin.html` (3,200+ lines) | XL |
| 36 | Dynamic `import()` for heavy modules on first `admin:section` visit | `admin-shared.js` `initNavigation`, `admin-rota.js`, `admin-time-punch.js`, `admin-employees.js` | L |
| 37 | Reduce initial JS payload on first paint | measure with Lighthouse | M |

---

### P2.2 Design system completion

| # | Task | Files | Effort |
|---|------|-------|--------|
| 38 | Single toast system (merge settings toast + `ShiftSwiftAction`) | `admin-settings.js`, `action-feedback.js`, `admin-shared.js` | M |
| 39 | Dialog component: focus trap + `aria-modal` on all overlays | rota copy modal, MFA, confirmations | M |
| 40 | Table captions + sort affordances for screen readers | `admin.html` tables, `renderTableBody` | M |
| 41 | Empty states audit — every list has action CTA | grep `emptyMessage` / `emptyStateHtml` usage | M |

---

### P2.3 Module depth parity

| # | Task | Files | Effort |
|---|------|-------|--------|
| 42 | Recruitment: CSV export + toast errors | `admin-recruitment.js` | M |
| 43 | Offboarding: export case summary PDF | `admin-offboarding.js`, backend route | L |
| 44 | CRM mobile layout pass | `admin-crm.js`, `admin-mobile-polish.css` | L |
| 45 | Grievance export parity with disciplinary | `admin-grievance.js` | S |

---

### P2.4 Native app parity

| # | Task | Files | Effort |
|---|------|-------|--------|
| 46 | Admin portal in unified Capacitor app (optional remote URL mode) | `mobile/`, `admin.html` native boot | L |
| 47 | Biometric unlock for HR admin on native | `trusted-device.js`, session | M |

---

## Suggested execution order

```
Week 0 (before pilot):     P0.1 → P0.2 → P0.3 smoke → P0.4
Week 1–2:                  P1.1 (alerts) + P1.2 (discoverability)
Week 3–4:                  P1.5 (Playwright) + P1.3 (mobile)
Month 2:                   P1.4 (offline banner) + P2.3 (exports)
Ongoing:                   P2.1 (split admin.html) when team bandwidth allows
```

---

## Quick reference — key files

| Concern | Primary files |
|---------|----------------|
| Shell & nav | `frontend/admin.html`, `frontend/admin-shared.js` |
| Overview / setup | `frontend/admin-workspace.js` |
| Employees | `frontend/admin-employees.js` |
| Rota | `frontend/admin-rota.js` |
| Time punch & QR | `frontend/admin-time-punch.js` |
| Documents | `frontend/admin-documents.js`, `frontend/admin-settings.js` |
| Mobile | `frontend/admin-mobile.js`, `frontend/admin-mobile-polish.css` |
| Auth | `frontend/session-auth.js`, `frontend/auth-guard.js` |
| PWA cache | `frontend/admin-sw.js` |
| API | `backend_stub/admin_routes.py`, `backend_stub/modules/` |

---

## Sign-off

| Milestone | Owner | Date | Notes |
|-----------|-------|------|-------|
| P0 complete | | | |
| P0.3 smoke passed on production | | | |
| P1 complete | | | |
| Ready for paid marketing | | | |

*Related: [launch_day_checklist.md](./launch_day_checklist.md) · [production_readiness.md](./production_readiness.md) · [b2b_launch_checklist.md](./b2b_launch_checklist.md)*
