# Pilot QA checklist — ShiftSwift HR admin

Use this after deploy to verify the pilot-ready UX polish (Sprints 1–4).

**Test accounts (local seed):** `hr@shiftswifthr.co.uk` / tenant HR password from `dev_credentials.py`

**Progress tracker:** [pilot_completion_tracker.md](./pilot_completion_tracker.md)

---

## Automated (CI / local)

```bash
bash scripts/run_pilot_qa_tests.sh
```

Or manually:

```bash
cd backend_stub
.venv/bin/python -m pytest tests/test_plan_features.py tests/test_time_punch.py tests/test_signup_legal.py tests/test_rota_attendance.py tests/test_rota_export_attendance.py tests/test_rota_export_pdf.py -q
```

Expected: all pass.

---

## Desktop admin (Chrome, width ≥ 861px)

| # | Check | Pass |
|---|--------|------|
| 1 | **Overview** shows stats row (employees, punches, open actions, subscription) | ☐ |
| 2 | **Open actions** panel visible on the right with module grid on the left | ☐ |
| 3 | Topbar **alerts bell** scrolls to open actions when clicked | ☐ |
| 4 | **Get your workspace ready** checklist shows until all 6 steps complete | ☐ |
| 5 | Locked modules (Grievance, Absence monitoring on Essentials) show lock on card | ☐ |
| 6 | **Settings → hub** shows setup banner with progress when checklist incomplete | ☐ |
| 7 | **Settings** plan label shows Essentials / Compliance / Multi-site (not Starter/Growth/Scale) | ☐ |
| 8 | **Time punch** link visible in sidebar even before punch site exists | ☐ |
| 9 | **Time punch → Geofence radius** card visible with Save radius | ☐ |
| 10 | **Leave** empty state shows CTA when no pending requests | ☐ |
| 11 | **Grievance / Disciplinary** empty register shows “Open case form” CTA | ☐ |
| 12 | Overview **Retry** appears if API fails (simulate offline briefly) | ☐ |

---

## Mobile admin (Chrome DevTools ≤ 860px or phone)

| # | Check | Pass |
|---|--------|------|
| 1 | First visit lands on **Home** tab with tab bar visible (not stuck in time-punch detail) | ☐ |
| 2 | **Compliance** tab hidden on Essentials plan (visible during trial / Compliance plan) | ☐ |
| 3 | Home shows stats + open actions + setup checklist | ☐ |
| 4 | **Modules** tab shows module grid | ☐ |
| 5 | **Employees** lifecycle empty stages show + Add employee CTA | ☐ |
| 6 | Alerts bell scrolls to open actions on Home | ☐ |

---

## Rota & attendance (after deploy of attendance fixes)

| # | Check | Pass |
|---|--------|------|
| 1 | **Rota → List view** — on-time clock-ins show **Attended**, not NO SHOW | ☐ |
| 2 | Hover **Attended** / **Late** badge — tooltip shows UK clock-in time | ☐ |
| 3 | **Export CSV** — file includes Day, Employee, Attendance, Clock in columns | ☐ |
| 4 | **Export PDF** — same data in table layout | ☐ |
| 5 | Evening shift (e.g. 17:00) — staff who punched before 16:45 still **Attended** | ☐ |
| 6 | **Time punch → Punch records** matches rota attendance for same shift | ☐ |

---

## Plan tiers

| Plan | Verify |
|------|--------|
| **Essentials** (or Starter ID) | Sponsor compliance section shows upgrade notice; grievance cards locked |
| **Compliance** (or trial) | Compliance tab, grievance, day-9, audit export accessible |
| **Trial** | Full Compliance features unlocked per `effective_features_for_tenant` |

---

## Clock on / off

| State | Verify |
|-------|--------|
| **No punch site** | Time punch nav still reachable; setup checklist shows “Set up time punch site” |
| **Punch site synced** | Overview punch stat active; employee clock enabled |

---

## Marketing (www)

| # | Check | Pass |
|---|--------|------|
| 1 | **How ShiftSwift HR compares** table visible between pricing and FAQ | ☐ |
| 2 | Spreadsheets comparison table still present | ☐ |

---

## Sign-off

| Role | Name | Date |
|------|------|------|
| Product | | |
| Pilot customer | | |

When all rows above are ticked, update [pilot_completion_tracker.md](./pilot_completion_tracker.md) Phase 2.
