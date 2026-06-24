# ShiftSwift HR — launch day checklist

**Use this on launch day.** Tick each box. One operator name + date at the bottom.

**Production URLs**

| Service | URL |
|---------|-----|
| Marketing | https://www.shiftswifthr.co.uk |
| App (HR + employee login) | https://app.shiftswifthr.co.uk/business-login.html |
| Platform master OPS | https://app.shiftswifthr.co.uk/ops-9x7k2.html |

**Do not use** `www.shiftswifthr.co.uk/business-login.html` — marketing links and nginx redirect app URLs to **app.**
| API health | https://api.shiftswifthr.co.uk/health |

**Note:** `/master-login.html` and `/tenant-login.html` redirect to business login — use **OPS** for platform master admin only.

**Server (CloudPanel)**

| Item | Path |
|------|------|
| API + repo | `/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk` |
| App frontend | `/home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk` |
| Marketing www | `/home/shiftswifthr/htdocs/www.shiftswifthr.co.uk` |

---

## A. Deploy (do first if not already done today)

- [ ] Pull latest release on the server:
  ```bash
  cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
  bash deploy/cloudpanel/pull-production.sh
  ```
  *(Or manually: `git pull --ff-only`, migrations, restart API, rsync frontend.)*
- [ ] **All migrations applied through `088_employee_profile_change_requests.sql`**
  ```bash
  bash scripts/run_migrations.sh
  ```
  Recent migrations you must not skip:
  | Migration | Adds |
  |-----------|------|
  | `080`–`083` | Document store audit, punch HR review, punch state flags |
  | `084`–`085` | Offboarding cancel reason, AI document add-on |
  | `086`–`087` | CRM addon price default, sign-in reminders + entity versions |
  | `088` | Employee profile change requests |
- [ ] `sudo systemctl restart shiftswifthr-api` (if not done by pull script)
- [ ] `curl -s https://api.shiftswifthr.co.uk/health` → `"status":"ok"`, `"environment":"production"`
- [ ] GDPR deploy verify:
  - [ ] `curl -s "https://api.shiftswifthr.co.uk/auth/reset-password/context?token=invalid"` → invalid/expired message (**not** 404)
  - [ ] `curl -s https://app.shiftswifthr.co.uk/password-reset.js | grep reset-password/context` → match found

### A.1 Post-deploy platform tidy (if you tested signup repeatedly)

- [ ] Sign in to **OPS** (`/ops-9x7k2.html`) as platform master
- [ ] **Tenants** list shows **Tenant #ID**, billing email, and **Primary account** / **Duplicate trial** badges
- [ ] Click **Remove duplicate trials** if duplicate test workspaces exist (keeps the primary HR login per email)
- [ ] Confirm one **Primary account** row per real pilot customer email

### A.2 Sales-led accounts (direct customers)

- [ ] OPS → **Create account** — offline billing + active access (no Stripe trial required)
- [ ] Billing notes recorded (agreed price, invoice cadence, PO reference)
- [ ] Welcome email received; HR password shared securely out of band
- [ ] Tenant shows **offline billing** in OPS detail

---

## B. Security & environment

- [ ] `APP_ENV=production` in `backend_stub/.env`
- [ ] `JWT_SECRET` ≥ 32 characters (not a dev default)
- [ ] `ENCRYPTION_KEY` set (64 hex chars — grievance notes)
- [ ] `FORCE_HTTPS=1`
- [ ] `CORS_ALLOW_ORIGINS` — `https://` only (app + www)
- [ ] `TRUSTED_HOSTS` includes www, app, api domains
- [ ] `chmod 600 backend_stub/.env`
- [ ] Dev/demo passwords rotated or removed on production
- [ ] **Two-factor authentication (production defaults):**
  - [ ] `MASTER_REQUIRE_MFA=1` (or rely on production default — on unless explicitly `0`)
  - [ ] `BUSINESS_REQUIRE_MFA=1` for HR admins (production default — on unless explicitly `0`)
  - [ ] `EMPLOYEE_REQUIRE_MFA=0` unless you require employee TOTP at launch
- [ ] Master OPS IP allowlist set if restricting platform console (`MASTER_IP_ALLOWLIST`)
- [ ] `bash scripts/security_audit.sh` run once post-deploy

---

## C. Backups & jobs

- [ ] Manual backup run succeeds:
  ```bash
  cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
  source scripts/load_env.sh && load_env_file backend_stub/.env
  bash scripts/backup_production.sh
  ```
- [ ] Backup files exist under `/var/backups/shiftswifthr/YYYY-MM-DD/`
- [ ] Daily backup cron configured for `shiftswifthr` user
- [ ] **Restore test** completed at least once (logged with date)
- [ ] Document uploads / RTW files included in backup scope (`DOCUMENTS_STORAGE_DIR`, `RTW_STORAGE_DIR`)
- [ ] Cron for `scripts/run_platform_jobs.py` (portal reminders, trials, template sync)
- [ ] Cron for `scripts/run_sponsor_compliance_jobs.sh` (if using sponsor features)
- [ ] Uptime monitor on `https://api.shiftswifthr.co.uk/health`

---

## D. Legal pages live

- [ ] https://www.shiftswifthr.co.uk/privacy-policy.html
- [ ] https://www.shiftswifthr.co.uk/cookies.html
- [ ] https://www.shiftswifthr.co.uk/eula.html
- [ ] https://www.shiftswifthr.co.uk/dpa.html
- [ ] https://www.shiftswifthr.co.uk/payment-terms.html
- [ ] Cookie banner works on www (accept + essential-only paths)

---

## E. 15-minute product smoke test (production)

Use a **real trial tenant** or pilot business — not demo passwords.

**One email = one HR workspace.** If signup was tested multiple times, use the email from the welcome message and check **Primary account** in OPS.

| # | Test | Pass |
|---|------|------|
| 1 | Business HR login → **authenticator enrollment** on first sign-in (production MFA) | ☐ |
| 2 | HR → **Settings → Security** → MFA status shows enabled; can view setup | ☐ |
| 3 | HR → Employees → send/resend **portal invite** | ☐ |
| 4 | Employee opens invite link → sees **employer GDPR notice** + checkbox | ☐ |
| 5 | Employee sets password → login opens **Employee** tab | ☐ |
| 6 | Employee portal loads (documents / overview) | ☐ |
| 7 | Employee → **Security** → optional MFA self-service (if offered) | ☐ |
| 8 | Time punch from phone **or** premises QR / kiosk (if customer will use it) | ☐ |
| 9 | HR → upload document → employee can download | ☐ |
| 10 | Self-service signup → legal checkboxes required → trial starts (duplicate email blocked) | ☐ |
| 11 | Welcome + getting-started emails received (check spam) | ☐ |
| 12 | Forgot password → reset link works (HR and Employee tabs) | ☐ |
| 13 | **OPS** login → tenant list shows **#ID + billing email**; pilot tenant is **Primary account** | ☐ |
| 14 | HR → **Settings → Users & access** → **Workspace ID** matches OPS tenant **#ID** | ☐ |
| 15 | Master admin **cannot** sign in on business HR tab (portal separation) | ☐ |

---

## F. Billing (only if charging on launch day)

- [ ] Stripe **live** keys in `.env` (not test)
- [ ] Webhook endpoint registered + `STRIPE_WEBHOOK_SECRET` set
- [ ] One live checkout completes
- [ ] Subscription / plan status updates in HR admin
- [ ] Direct Debit path tested (if offered)

---

## G. Customer onboarding (tell every new business)

- [ ] Customer signed **MSA + DPA** (or your signing process started)
- [ ] Customer told: **they are the data controller** for employee data
- [ ] Customer told: they need their own **employee privacy notice** (mention HR system + Time Clock GPS if used)
- [ ] Customer knows: sign in on **Employee** tab for staff portal (not Business HR)
- [ ] Customer knows: **one billing email = one HR workspace** — use the email from signup/welcome mail
- [ ] Customer knows: HR will be prompted for **authenticator app (2FA)** on first login in production
- [ ] Customer knows: portal invite emails may land in **junk** — use Resend in Employees panel

---

## H. Organisational (not code — confirm before scale)

- [ ] ICO registration current
- [ ] Breach notification owner assigned (`legal@datasoftwareanalytics.co.uk`)
- [ ] SAR / erasure process documented
- [ ] Support inbox monitored: **support@shiftswifthr.co.uk**
- [ ] PI / cyber insurance (recommended)

---

## I. Launch decision

**Soft launch (pilot customer)** — ready when **A + B + C + D + E** are ticked (include **A.1** if you tested signup on production).

**Paid launch / marketing spend** — also tick **F + G + H**.

| Decision | Tick one |
|----------|----------|
| Go — soft launch with pilot customer | ☐ |
| Go — open to paying customers | ☐ |
| No-go — blockers listed below | ☐ |

**Blockers (if any):**

```
1.
2.
3.
```

---

## Sign-off

| Field | Value |
|-------|-------|
| Operator | |
| Date | |
| Pilot / first customer name | |
| Pilot tenant ID (from OPS) | |
| Notes | |

---

*Related: [production_readiness.md](./production_readiness.md) · [b2b_launch_checklist.md](./b2b_launch_checklist.md) · [compliance_checklist.md](./compliance_checklist.md)*
