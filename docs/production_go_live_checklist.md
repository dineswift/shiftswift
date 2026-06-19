# Production go-live checklist — ShiftSwift HR

One-page checklist for **srv1741712 / CloudPanel** paths. Tick before onboarding paying customers.

**Server paths (your install)**

| Item | Path |
|------|------|
| API + repo | `/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk` |
| App frontend | `/home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk` |
| Marketing www | `/home/shiftswifthr/htdocs/www.shiftswifthr.co.uk` |
| RTW PDFs | `uploads/rtw_immutable` (or `RTW_STORAGE_DIR` in `.env`) |
| HR documents | `uploads/documents` (or `DOCUMENTS_STORAGE_DIR` in `.env`) |

---

## A. Deploy (done if migrations 043–045 applied)

- [ ] `git pull --ff-only` on API site
- [ ] `bash scripts/run_migrations.sh` (through **045**)
- [ ] `DOCUMENTS_STORAGE_DIR` and `RTW_STORAGE_DIR` in `backend_stub/.env`
- [ ] `mkdir -p uploads/documents` · `chown shiftswifthr:shiftswifthr uploads/*` · `chmod 750 uploads/*`
- [ ] `chmod 600 backend_stub/.env`
- [ ] `sudo systemctl restart shiftswifthr-api`
- [ ] Rsync `frontend/` → www + app docroots

---

## B. Backups (required)

**Daily backup script** (Postgres + RTW + document uploads):

```bash
cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
source scripts/load_env.sh && load_env_file backend_stub/.env
bash scripts/backup_production.sh
```

**Cron** (as root — create log dir first):

```bash
mkdir -p /var/log/shiftswifthr /var/backups/shiftswifthr
chown shiftswifthr:shiftswifthr /var/log/shiftswifthr /var/backups/shiftswifthr

crontab -u shiftswifthr -e
```

Add:

```cron
# ShiftSwift HR — daily backup 08:30 UTC
30 8 * * * cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk && source scripts/load_env.sh && load_env_file backend_stub/.env && bash scripts/backup_production.sh >> /var/log/shiftswifthr/backup.log 2>&1

# Sponsor compliance alerts — daily 08:00 UK (before 09:00 inbox)
0 8 * * * cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk && bash scripts/run_sponsor_compliance_jobs.sh >> /var/log/shiftswifthr/compliance-jobs.log 2>&1

# Shift push reminders + platform jobs — every 15 min (required for 10-min-before-shift alerts)
*/15 * * * * cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk && source scripts/load_env.sh && load_env_file backend_stub/.env && backend_stub/.venv/bin/python scripts/run_platform_jobs.py >> /var/log/shiftswifthr/platform-jobs.log 2>&1
```

- [ ] First manual backup succeeds (`/var/backups/shiftswifthr/YYYY-MM-DD/`)
- [ ] **Restore test** completed (see below) — at least once before launch
- [ ] Off-site copy (S3, second VPS, or provider snapshot) — recommended

### Restore smoke test (staging or spare DB)

```bash
# 1. Pick latest backup
BACKUP=/var/backups/shiftswifthr/2026-06-10   # adjust date
DB_RESTORE=shiftswift_hr_restore_test

# 2. Restore Postgres to a test database (do NOT overwrite production)
gunzip -c "$BACKUP"/postgres_*.sql.gz | sudo -u postgres psql -d postgres -c "DROP DATABASE IF EXISTS ${DB_RESTORE};"
gunzip -c "$BACKUP"/postgres_*.sql.gz | sudo -u postgres psql -d postgres -c "CREATE DATABASE ${DB_RESTORE};"
gunzip -c "$BACKUP"/postgres_*.sql.gz | sudo -u postgres psql -d "${DB_RESTORE}"

# 3. Restore uploads to a temp folder and spot-check a file path from DB
mkdir -p /tmp/shiftswift-restore-test
tar -xzf "$BACKUP"/uploads_*.tar.gz -C /tmp/shiftswift-restore-test

# 4. Verify: file count > 0 if you have uploads; open one PDF
find /tmp/shiftswift-restore-test -type f | head
```

- [ ] Restore test logged with date + operator initials

---

## C. 15-minute product smoke test (production URLs)

Run on `https://app.shiftswifthr.co.uk` with a real trial tenant:

| # | Test | Pass |
|---|------|------|
| 1 | `https://api.shiftswifthr.co.uk/health` → OK | ☐ |
| 2 | Business login (+ MFA if enabled) | ☐ |
| 3 | Employee login → time punch (GPS if used) | ☐ |
| 4 | Settings → Document store → upload PDF → Download | ☐ |
| 5 | Export CSV manifest + ZIP pack | ☐ |
| 6 | Employee → Document store → upload → Download | ☐ |
| 7 | Sponsor Compliance → duty acknowledgement → RTW upload | ☐ |
| 8 | Signup trial email received (Brevo) | ☐ |
| 9 | Cookie banner on www (accept / essential-only) | ☐ |

---

## D. Security & ops

- [ ] `APP_ENV=production` · strong `JWT_SECRET` (≥32 chars) · `ENCRYPTION_KEY` set
- [ ] `FORCE_HTTPS=1` · TLS on www / app / api
- [ ] `CORS_ALLOW_ORIGINS` = `https://` only (app + www)
- [ ] `TRUSTED_HOSTS` includes all three domains
- [ ] Dev/demo passwords rotated or removed
- [ ] API runs as `shiftswifthr` (not root) — `systemctl cat shiftswifthr-api`
- [ ] Uptime monitor on `/health`
- [ ] `bash scripts/security_audit.sh` run once post-deploy

---

## E. Billing (if charging at launch)

- [ ] Stripe **live** keys in `.env`
- [ ] Webhook endpoint registered · secret set
- [ ] One live checkout + subscription status updates in admin
- [ ] Direct Debit / Bacs path tested if offered

---

## F. Legal & compliance (organisational — not code)

See also `docs/compliance_checklist.md`.

- [ ] ICO registration current
- [ ] Privacy policy + cookies + EULA live (solicitor-reviewed if claimed)
- [ ] Customer DPA process · tell customers they need an **employee privacy notice**
- [ ] Breach + SAR runbook owner (`legal@datasoftwareanalytics.co.uk`)
- [ ] PI / cyber insurance (recommended)

---

## G. Post-launch (first 30 days)

- [ ] Monitor `/var/log/shiftswifthr/` and `journalctl -u shiftswifthr-api`
- [ ] Monthly: restore test + `security_audit.sh`
- [ ] First customer onboarding notes (what broke, what to document)

---

## Quick deploy command (reference)

```bash
cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk && git pull --ff-only && source backend_stub/.venv/bin/activate && source scripts/load_env.sh && load_env_file backend_stub/.env && bash scripts/run_migrations.sh && sudo systemctl restart shiftswifthr-api && rsync -a --delete frontend/ /home/shiftswifthr/htdocs/www.shiftswifthr.co.uk/ && rsync -a --delete frontend/ /home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk/
```

**Related:** [production_readiness.md](./production_readiness.md) · [compliance_checklist.md](./compliance_checklist.md) · [GIT-DEPLOY.md](../deploy/cloudpanel/GIT-DEPLOY.md)
