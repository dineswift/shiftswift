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
git pull
source backend_stub/.venv/bin/activate
pip install -r backend_stub/requirements.txt
set -a && source backend_stub/.env && set +a
bash scripts/run_migrations.sh
sudo systemctl restart shiftswifthr-api
rsync -a --delete frontend/ /home/shiftswifthr-app/htdocs/app.shiftswifthr.co.uk/
rsync -a --delete frontend/ /home/shiftswifthr/htdocs/www.shiftswifthr.co.uk/
```

**Legal pages:** Canonical URLs are `/payment-terms.html`, `/privacy-policy.html`, `/cookies.html`, `/eula.html`, `/dpa.html`, `/delete-account.html`. Deploy with `pull-production.sh` (rsyncs `frontend/`, including the www marketing allowlist).

Legacy `/docs/*.md` links: optional nginx rewrites in `deploy/cloudpanel/www-legal-redirects.snippet`. **Do not paste Apache `.htaccess` into CloudPanel nginx config** — use the rewrite lines from that snippet only.

If the site shows an nginx error after editing vhost config, remove the bad custom config, run `sudo nginx -t`, then reload nginx.

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
