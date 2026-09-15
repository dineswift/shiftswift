# ShiftSwift HR — Git deploy on CloudPanel

Repository: **https://github.com/kharel2020/shiftswift.git**

## Site paths (your server)

| Domain | Linux user | Document root |
|--------|------------|---------------|
| `api.shiftswifthr.co.uk` | `shiftswifthr-api` | `/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk` |
| `app.shiftswifthr.co.uk` | `shiftswifthr-app` | `/home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk` |
| `www.shiftswifthr.co.uk` | `shiftswifthr` | `/home/shiftswifthr/htdocs/www.shiftswifthr.co.uk` |

---

## First-time clone (API site)

SSH as root or `shiftswifthr-api`:

```bash
sudo apt update && sudo apt install -y git

API_ROOT=/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
cd "$API_ROOT"

# Back up production .env if you already deployed via zip
[ -f backend_stub/.env ] && cp backend_stub/.env /root/shiftswift.env.backup

# Clone into site root (folder must be empty or use a temp dir first)
git clone https://github.com/kharel2020/shiftswift.git .

# If the folder is NOT empty (existing zip deploy), use temp clone + rsync instead:
# rm -rf /tmp/shiftswift-repo "$API_ROOT/.git"
# git clone https://github.com/kharel2020/shiftswift.git /tmp/shiftswift-repo
# rsync -a --exclude '.git' --exclude 'backend_stub/.env' --exclude 'backend_stub/.venv' \
#   /tmp/shiftswift-repo/ "$API_ROOT/"
# mv /tmp/shiftswift-repo/.git "$API_ROOT/" && rm -rf /tmp/shiftswift-repo
# cp /root/shiftswift.env.backup "$API_ROOT/backend_stub/.env"

# Private repo: use a GitHub Personal Access Token as the password, or set up an SSH deploy key:
# git clone git@github.com:kharel2020/shiftswift.git .

chmod +x deploy/cloudpanel/install-api.sh scripts/run_migrations.sh
bash deploy/cloudpanel/install-api.sh

# Restore or edit secrets — never commit this file
nano backend_stub/.env
```

Copy settings from `backend_stub/.env.production.example` and your backup. Minimum:

```bash
PROVIDER_LEGAL_NAME="Datasoftware Analytics Ltd"
PROVIDER_COMPANY_NUMBER="14568900"
PROVIDER_ADDRESS="235 Charlbury Road, Nottingham, NG8 1NF"
TRUSTED_HOSTS=api.shiftswifthr.co.uk,app.shiftswifthr.co.uk,www.shiftswifthr.co.uk
```

Run migrations and restart API:

```bash
cd "$API_ROOT"
set -a && source backend_stub/.env && set +a
bash scripts/run_migrations.sh
sudo systemctl restart shiftswifthr-api
bash deploy/cloudpanel/wait-api-health.sh
curl -s https://api.shiftswifthr.co.uk/health
```

---

## First-time frontend sync

From the API clone (same repo contains `frontend/`):

```bash
API_ROOT=/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
APP_ROOT=/home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk
WWW_ROOT=/home/shiftswifthr/htdocs/www.shiftswifthr.co.uk

rsync -a --delete "$API_ROOT/frontend/" "$APP_ROOT/"
rsync -a --delete "$API_ROOT/frontend/" "$WWW_ROOT/"
```

Open `https://app.shiftswifthr.co.uk/business-login.html` and hard-refresh.

---

## Every update (`git pull`)

On the server:

```bash
bash /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk/deploy/cloudpanel/pull-production.sh
```

Or manually:

```bash
cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
git fetch origin
git checkout cursor/fix-admin-tab-tenant-title-39e0
git pull --ff-only origin cursor/fix-admin-tab-tenant-title-39e0
source backend_stub/.venv/bin/activate
pip install -r backend_stub/requirements.txt
set -a && source backend_stub/.env && set +a
bash scripts/run_migrations.sh
sudo systemctl restart shiftswifthr-api
bash deploy/cloudpanel/wait-api-health.sh
rsync -a --delete frontend/ /home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk/
if [ -f frontend/app-root-index.html ]; then
  cp frontend/app-root-index.html /home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk/index.html
fi
```

`wait-api-health.sh` blocks until `http://127.0.0.1:8000/health` is **HTTP 200**. If it is not, the script prints `journalctl` and **does not rsync**. Do not rsync while the API is down.

**Legal pages:** Canonical URLs are `/payment-terms.html`, `/privacy-policy.html`, `/cookies.html`, `/eula.html`, `/dpa.html`. Deploy with `pull-production.sh` (rsyncs `frontend/`).

Legacy `/docs/*.md` links: optional nginx rewrites in `deploy/cloudpanel/www-legal-redirects.snippet`. **Do not paste Apache `.htaccess` into CloudPanel nginx config** — use the rewrite lines from that snippet only.

If the site shows an nginx error after editing vhost config, remove the bad custom config, run `sudo nginx -t`, then reload nginx.

---

## If `/health` is 502 or `curl :8000` is connection refused

**502 means nginx could not reach uvicorn.** **Connection refused on `127.0.0.1:8000` means uvicorn is not listening at all.** Git checkout only updates files on disk. `systemctl restart` returns when the process is spawned, not when `/health` is 200. Frontend `rsync` does not start the API — run it **only after** local health is 200.

This stack (`cursor/fix-qr-print-cards-39e0`, and earlier `cursor/rota-printable-pdf-39e0`) imports `qrcode` and `reportlab` while loading `main:app`. A checkout without `pip install`, or an ImportError in those modules, crashes the workers immediately so nothing binds `:8000`.

One-shot recover (installs deps, preflight import, restart, wait for HTTP 200, **then** rsync):

```bash
bash /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk/deploy/cloudpanel/recover-api-502.sh
```

### Pasteable recovery (run as root or with sudo)

```bash
API_ROOT=/home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
APP_ROOT=/home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk
WWW_ROOT=/home/shiftswifthr/htdocs/www.shiftswifthr.co.uk
cd "$API_ROOT"

git rev-parse --abbrev-ref HEAD
git log -1 --oneline

# Why uvicorn is not on :8000
sudo systemctl status shiftswifthr-api --no-pager -l
sudo journalctl -u shiftswifthr-api -n 80 --no-pager

# Same imports uvicorn runs at start (ImportError here = connection refused after restart)
source backend_stub/.venv/bin/activate
pip install -r backend_stub/requirements.txt
cd "$API_ROOT/backend_stub"
python -c "import qrcode, reportlab; import main; print('ok', main.app.title)"
cd "$API_ROOT"

# Start / restart and wait until health is HTTP 200
sudo systemctl reset-failed shiftswifthr-api
sudo systemctl restart shiftswifthr-api
sudo systemctl is-active shiftswifthr-api
bash deploy/cloudpanel/wait-api-health.sh

# Only after local health is 200
rsync -a --delete "$API_ROOT/frontend/" "$APP_ROOT/"
if [ -f "$API_ROOT/frontend/app-root-index.html" ]; then
  cp "$API_ROOT/frontend/app-root-index.html" "$APP_ROOT/index.html"
fi

curl -sS https://api.shiftswifthr.co.uk/health; echo
```

- `is-active` is not `active`, or journal / preflight shows `ImportError` / traceback → fix that error (`pip install` or restore the missing module), then restart and wait again.
- Local `:8000` is `{"status":"ok"...}` but the public URL is still 502 → `sudo nginx -t && sudo systemctl reload nginx`.
- Then retry sign-in at `https://app.shiftswifthr.co.uk/business-login.html`. A wrong password should return **invalid credentials**, not **Cannot reach the API**.

---

## SSH deploy key (recommended)

On the server as `shiftswifthr-api`:

```bash
ssh-keygen -t ed25519 -C "cloudpanel-shiftswift" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add the public key in GitHub → **kharel2020/shiftswift** → **Settings → Deploy keys → Add deploy key** (read-only).

Then switch remote:

```bash
cd /home/shiftswifthr-api/htdocs/api.shiftswifthr.co.uk
git remote set-url origin git@github.com:kharel2020/shiftswift.git
git pull
```

---

## Do not overwrite

| Keep on server | Reason |
|----------------|--------|
| `backend_stub/.env` | Secrets, DB URL, JWT |
| PostgreSQL data | Live tenants |
| `uploads/` / `/var/lib/shiftswift-hr/` | RTW and contract files |

`git pull` will not change `.env` if it is listed in `.gitignore` (default for this project).
