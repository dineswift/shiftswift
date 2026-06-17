# Phase 2 runbook — deploy and verify in one sitting

One copy-paste workflow to deploy production and complete **Phase 2** of the pilot checklist. Budget **60–90 minutes**.

**Outputs:** production on latest `main`, manual QA ticked, [pilot_completion_tracker.md](./pilot_completion_tracker.md) Phase 2 updated.

**Related:** [pilot_qa_checklist.md](./pilot_qa_checklist.md) · [pilot_completion_tracker.md](./pilot_completion_tracker.md)

---

## Before you start

| Item | Notes |
|------|--------|
| SSH to CloudPanel server | User that can `sudo systemctl restart shiftswifthr-api` |
| Browser | Chrome (desktop + DevTools mobile ≤ 860px) |
| Pilot tenant | e.g. **Himalayan Inn** (Compliance plan) — your real admin login |
| Optional phone | One real clock-in for punch + rota cross-check |
| Local repo | Optional pre-flight tests on your Mac |

**URLs**

| Site | URL |
|------|-----|
| Admin login | https://app.shiftswifthr.co.uk/business-login.html |
| API health | https://api.shiftswifthr.co.uk/health |
| Marketing | https://www.shiftswifthr.co.uk/ |

**Local seed (dev only — do not use on production unless unchanged):** `hr@shiftswifthr.co.uk` / `ShiftswiftHR-Tenant-2026` (tenant `1`)

---

## Part A — Pre-flight on your Mac (optional, ~5 min)

```bash
cd /Users/gskharel/Desktop/shiftswifthr
git fetch origin && git log -1 --oneline origin/main
bash scripts/run_pilot_qa_tests.sh
```

Expected: pytest bundle passes. Note the commit hash — you want that on the server after deploy.

---

## Part B — Deploy on the server (~10 min)

SSH in, then paste:

```bash
cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
git fetch origin
git log -1 --oneline origin/main
bash deploy/cloudpanel/pull-production.sh
```

**Success looks like:**

- `git pull` completes (no merge conflicts)
- `migrations` runs without error
- `restart shiftswifthr-api` OK
- `sync frontend` + WWW rsync OK
- `health check` returns JSON with `"status":"ok"`
- Script ends with `Done.`

**If deploy fails**

```bash
sudo journalctl -u shiftswifthr-api -n 80 --no-pager
sudo systemctl status shiftswifthr-api --no-pager -l
```

**Record deploy commit on server:**

```bash
git rev-parse --short HEAD
```

Paste into [pilot_completion_tracker.md](./pilot_completion_tracker.md) (“Last deploy commit”).

---

## Part C — API smoke (~2 min)

From your Mac (or server):

```bash
curl -sS https://api.shiftswifthr.co.uk/health | jq .
```

Expected: `"status": "ok"`.

Optional — confirm app static assets updated (cache-bust version in admin bundle):

```bash
curl -sS https://app.shiftswifthr.co.uk/admin.html | grep -o 'admin-shared.js?v=[^"]*' | head -1
```

After CRM nav fix deploy you should see `admin-shared.js?v=admin-v36` (or newer).

---

## Part D — Hard refresh and login (~3 min)

1. Open https://app.shiftswifthr.co.uk/business-login.html
2. **Hard refresh:** Mac `Cmd+Shift+R` (or empty cache for the site once)
3. Log in as your **pilot tenant admin** (e.g. Himalayan Inn)
4. Confirm top bar shows correct business name and plan

---

## Part E — Desktop admin (Chrome, width ≥ 861px) (~20 min)

Open https://app.shiftswifthr.co.uk/admin.html#overview

Tick as you go ([full table](./pilot_qa_checklist.md#desktop-admin-chrome-width--861px)):

| ✓ | Action | Pass if |
|---|--------|---------|
| ☐ | Overview | Stats row: employees, today’s punches, open actions, subscription |
| ☐ | Layout | Module grid left, **Open actions** panel right |
| ☐ | Alerts bell | Click bell → scrolls/focuses open actions |
| ☐ | Setup checklist | “Get your workspace ready” visible until 6/6 (or hidden when complete) |
| ☐ | Locked modules | Grievance / absence cards show lock on Essentials; Compliance tenant unlocked |
| ☐ | Settings hub | `#settings` — setup banner when checklist incomplete |
| ☐ | Plan label | Shows **Essentials / Compliance / Multi-site** (not Starter/Growth/Scale) |
| ☐ | Time punch nav | Sidebar link visible even before punch site exists |
| ☐ | Geofence | `#time-punch` → Geofence radius card + **Save radius** |
| ☐ | Leave empty | `#leave` — CTA when no pending requests |
| ☐ | Grievance / Disciplinary | Empty register → “Open case form” CTA |
| ☐ | Retry | Brief offline (DevTools → Network offline) on Overview → **Retry** appears |

**CRM (only if Sales CRM add-on enabled for tenant)**

| ✓ | Action | Pass if |
|---|--------|---------|
| ☐ | Sidebar CRM | Click **CRM** → pipeline / companies UI (not stuck on Overview) |
| ☐ | No addon | CRM link hidden; `#crm` shows upgrade notice, not silent Overview |

---

## Part F — Mobile admin (≤ 860px) (~15 min)

Chrome DevTools → device toolbar → width **390px** (or use phone).

| ✓ | Action | Pass if |
|---|--------|---------|
| ☐ | First visit | Lands on **Home** tab; tab bar visible (not stuck in time-punch detail) |
| ☐ | Compliance tab | Hidden on Essentials; visible on Compliance / trial |
| ☐ | Home | Stats + open actions + setup checklist |
| ☐ | Modules tab | Module grid |
| ☐ | Employees | Lifecycle empty stages + **Add employee** CTA |
| ☐ | Alerts bell | Scrolls to open actions on Home |

---

## Part G — Rota & attendance (critical) (~15 min)

Use tenant with time punch + rota (Himalayan Inn).

1. Go to **Rota** → **List view** / **Shifts this week**
2. Find a shift where staff **clocked in on time** (e.g. Shankar, Tue 17:00–22:00)

| ✓ | Check | Pass if |
|---|--------|---------|
| ☐ | Attendance badge | **Attended** or **Late** — not **NO SHOW** for punched shift |
| ☐ | Hover tooltip | Badge shows UK clock-in time |
| ☐ | Evening shift | Punch before shift start (e.g. 16:45 for 17:00) still **Attended** |
| ☐ | Export CSV | Button downloads file with Day, Employee, Attendance, Clock in |
| ☐ | Export PDF | Same columns in PDF table |
| ☐ | Punch records | `#time-punch` → Punch records matches rota for same shift |

**Optional live punch**

| ✓ | Check | Pass if |
|---|--------|---------|
| ☐ | Phone clock-in | Staff punches on phone → appears in Punch records within ~1 min |
| ☐ | Rota sync | Same punch reflected on rota list attendance |

---

## Part H — Marketing www (~5 min)

https://www.shiftswifthr.co.uk/

| ✓ | Check | Pass if |
|---|--------|---------|
| ☐ | Comparison table | “How ShiftSwift HR compares” between pricing and FAQ |
| ☐ | Spreadsheets table | Legacy comparison table still present |

Hard refresh www once (`Cmd+Shift+R`).

---

## Part I — Sign-off and tracker

1. Tick desktop rows in [pilot_qa_checklist.md](./pilot_qa_checklist.md)
2. Tick mobile + rota sections
3. Update Phase 2 in [pilot_completion_tracker.md](./pilot_completion_tracker.md):

| Task | Done |
|------|------|
| `pull-production.sh` on server | ☐ |
| Hard-refresh app + www | ☐ |
| Shankar / Tue attendance **Attended** + hover | ☐ |
| CSV/PDF export from Shifts this week | ☐ |
| Desktop checklist 1–12 | ☐ |
| Mobile checklist 1–6 | ☐ |
| One real staff clock-in (optional) | ☐ |

4. Phase 2 complete → target rating **8.5 / 10** pilot ([tracker](./pilot_completion_tracker.md#rating-targets))

| Role | Name | Date |
|------|------|------|
| Product | | |
| Pilot customer | | |

---

## Quick reference — one paste block (server only)

```bash
cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk && \
git fetch origin && git log -1 --oneline origin/main && \
bash deploy/cloudpanel/pull-production.sh && \
git rev-parse --short HEAD && \
curl -sS http://127.0.0.1:8000/health
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Old UI after deploy | Browser cache | Hard refresh; check `admin-shared.js?v=` in page source |
| Rota still NO SHOW | Deploy not on server or wrong week | Confirm server `git rev-parse HEAD` matches Mac `origin/main` |
| CRM shows Overview | Stale hash nav bug | Deploy `admin-v36+`; hard refresh; click CRM again |
| CRM missing entirely | Add-on not enabled | Master Ops → tenant → enable **CRM add-on** |
| Migrations error | DB drift | `journalctl` + fix migration; do not skip on production without backup |
| Health check fails | API crash | `sudo journalctl -u shiftswifthr-api -n 80 --no-pager` |
