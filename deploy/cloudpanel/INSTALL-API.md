# ShiftSwift HR — API install (CloudPanel Python site)

Upload **shiftswifthr-api.zip** to your server, **or clone from Git** — see [GIT-DEPLOY.md](./GIT-DEPLOY.md)  
(`https://github.com/kharel2020/shiftswift.git`).

Extract into the Python site root  
(e.g. `/home/<user>/htdocs/api.shiftswifthr.co.uk/`).

## 1. Extract

```bash
cd /home/<user>/htdocs/api.shiftswifthr.co.uk
unzip -o shiftswifthr-api.zip
chmod +x install-api.sh scripts/run_migrations.sh
```

## 2. Run installer

```bash
bash install-api.sh
```

This creates the Python venv, installs dependencies, and prints next steps.

## 3. Configure environment

Edit `backend_stub/.env` (copy from `backend_stub/.env.production.example` if missing):

- `APP_ENV=production`
- `DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5432/shiftswift_hr`
- `JWT_SECRET` — at least 32 random characters
- `ENCRYPTION_KEY` — 64 hex characters
- `FORCE_HTTPS=1`
- `CORS_ALLOW_ORIGINS=https://app.shiftswifthr.co.uk,https://www.shiftswifthr.co.uk`
- `TRUSTED_HOSTS=api.shiftswifthr.co.uk,app.shiftswifthr.co.uk,www.shiftswifthr.co.uk`
- Native push (optional but required for Android FCM / iOS APNs delivery):
  - `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=co.uk.shiftswifthr.app`, `APNS_USE_SANDBOX=false`
  - `FIREBASE_SERVICE_ACCOUNT_JSON=/absolute/path/to/firebase-adminsdk.json` (store under `backend_stub/secrets/`, gitignored)

## 4. PostgreSQL (once per server)

```bash
apt update && apt install -y postgresql postgresql-contrib
sudo -u postgres createuser shiftswift -P
sudo -u postgres createdb shiftswift_hr -O shiftswift
```

## 5. Migrations and seed

```bash
cd /home/<user>/htdocs/api.shiftswifthr.co.uk
set -a && source backend_stub/.env && set +a
bash scripts/run_migrations.sh
python3 scripts/seed_app_users.py
python3 scripts/seed_billing_catalog.py
python3 scripts/seed_contract_templates.py
python3 scripts/seed_tenant_branding.py
python3 scripts/seed_hr_templates.py
python3 scripts/seed_time_punch.py
```

Change default passwords before going live.

## 6. CloudPanel Python site settings

| Setting | Value |
|---------|--------|
| Working directory | `backend_stub` |
| Start command | `.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2` |
| Port | `8000` |

Enable SSL in CloudPanel, then test:

```bash
curl -s https://api.shiftswifthr.co.uk/health
```
