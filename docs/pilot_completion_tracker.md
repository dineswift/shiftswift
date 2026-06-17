# Pilot completion tracker

Track progress toward **9/10 pilot-ready**. Update after each deploy and manual QA pass.

**Last automated run:** use `bash scripts/run_pilot_qa_tests.sh`  
**Last deploy commit:** check `git log -1 --oneline` on production after `pull-production.sh`

---

## Phase 1 — Code shipped (Sprints 1–4)

| Item | Status | Notes |
|------|--------|-------|
| Desktop overview stats + open actions | ✅ Code | `admin-workspace.js`, `admin.html` |
| Alerts bell → open actions | ✅ Code | `admin-mobile.js`, `mobile-shell.js` |
| Mobile first visit → Home tab | ✅ Code | `admin-mobile.js` |
| Setup checklist (6 steps) | ✅ Code | `admin_overview` API + `admin-workspace.js` |
| Plan names Essentials / Compliance / Multi-site | ✅ Code | `plan_features.py`, `admin-shared.js` |
| Empty states + CTAs | ✅ Code | `admin-shared.js`, leave/grievance/disciplinary |
| Time punch state machine + HR review | ✅ Code | migrations 082–083 |
| Rota attendance UK timezone | ✅ Code | `029fe60`, `22e32b7` |
| Rota list UX + hover clock-in | ✅ Code | `40e2be8` |
| Shifts attendance CSV/PDF export | ✅ Code | `export_attendance.py` |
| Competitive comparison on www | ✅ Code | `index.html`, `docs/competitive_comparison.md` |
| Missed punch alerts UK date | ✅ Code | `missed_punch.py` uses Europe/London |

---

## Phase 2 — Deploy & verify (you)

| # | Task | Done |
|---|------|------|
| 1 | Run `bash deploy/cloudpanel/pull-production.sh` on server | ☐ |
| 2 | Hard-refresh app + www (cache bust) | ☐ |
| 3 | Rota list: Shankar Tue 16 Jun 17:00 → **Attended** (hover shows clock-in) | ☐ |
| 4 | Export CSV/PDF from Shifts this week — opens with attendance columns | ☐ |
| 5 | Complete desktop rows 1–12 in `pilot_qa_checklist.md` | ☐ |
| 6 | Complete mobile rows 1–6 in `pilot_qa_checklist.md` | ☐ |
| 7 | One real staff member clocks in on phone — appears in Punch records + rota | ☐ |

---

## Phase 3 — Launch credibility (next)

| # | Task | Done |
|---|------|------|
| 1 | Stripe live prices match Essentials / Compliance / Multi-site | ☐ |
| 2 | Backup + restore test on staging | ☐ |
| 3 | MSA + DPA ready for first paying customer | ☐ |
| 4 | Replace www UI mocks with live admin screenshots | ☐ |
| 5 | One pilot site using product daily for 2 weeks | ☐ |
| 6 | Named case study quote (with permission) | ☐ |

---

## Rating targets

| Milestone | Target score |
|-----------|----------------|
| After Phase 2 sign-off | **8.5 / 10** pilot |
| After Phase 3 + first paying pilot | **9 / 10** |
