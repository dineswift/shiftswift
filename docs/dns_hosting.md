# DNS & hosting — shiftswifthr.co.uk

Production layout for ShiftSwift HR. Replace example IPs with your host (VPS, Railway, Fly.io, AWS, etc.).

## Subdomain map

| Host | Purpose | Serves |
|------|---------|--------|
| `shiftswifthr.co.uk` | Apex / marketing redirect | 301 → `www` |
| `www.shiftswifthr.co.uk` | Marketing site | Static `frontend/` (index, legal pages) |
| `app.shiftswifthr.co.uk` | Tenant & master admin UI | Same static app + `admin.html`, login pages |
| `api.shiftswifthr.co.uk` | FastAPI backend | `uvicorn main:app` (port 8000 behind proxy) |

Local development uses `http://localhost:5173` (frontend) and `http://localhost:3000` (API). Brand config auto-switches via `frontend/brand-config.js` and `GET /setup/brand`.

## DNS records (typical)

At your registrar (e.g. Cloudflare, Namecheap, Route 53):

| Type | Name | Value | Notes |
|------|------|-------|-------|
| `A` or `CNAME` | `@` | Your load balancer / CDN | Or CNAME to `www` if registrar supports flattening |
| `CNAME` | `www` | CDN or web host | Marketing static files |
| `CNAME` | `app` | CDN or web host | Can share bucket with `www` + path rules |
| `CNAME` | `api` | API host / load balancer | Must support HTTPS + long-lived connections |
| `TXT` | `@` | SPF for email | e.g. `v=spf1 include:_spf.google.com ~all` |
| `TXT` | `_dmarc` | DMARC policy | Start with `p=none`, tighten later |
| `MX` | `@` | Mail provider | For `support@`, `noreply@` |

**Example (single VPS, all on one IP):**

```
A     @      203.0.113.10
A     www    203.0.113.10
A     app    203.0.113.10
A     api    203.0.113.10
```

**Example (Cloudflare + separate API):**

```
CNAME www    shiftswifthr.pages.dev   (proxied)
CNAME app    shiftswifthr.pages.dev   (proxied)
CNAME api    api-xxxxx.fly.dev        (DNS only — grey cloud if WebSockets/long uploads)
```

## TLS / HTTPS

- Terminate TLS at the reverse proxy (Caddy or nginx) or CDN (Cloudflare).
- Set `FORCE_HTTPS=1` and `APP_ENV=production` in `backend_stub/.env`.
- Ensure certificates cover: `shiftswifthr.co.uk`, `www`, `app`, and `api`.

### Caddy (minimal)

```caddy
shiftswifthr.co.uk {
  redir https://www.shiftswifthr.co.uk{uri}
}

www.shiftswifthr.co.uk, app.shiftswifthr.co.uk {
  root * /var/www/shiftswifthr/frontend
  file_server
  try_files {path} /index.html
}

api.shiftswifthr.co.uk {
  reverse_proxy 127.0.0.1:8000
}
```

Deploy the `frontend/` folder to `/var/www/shiftswifthr/frontend`. Both `www` and `app` can serve the same files; login pages live at `/tenant-login.html` and `/master-login.html`.

### nginx (API only snippet)

```nginx
server {
  listen 443 ssl http2;
  server_name api.shiftswifthr.co.uk;

  ssl_certificate     /etc/letsencrypt/live/api.shiftswifthr.co.uk/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.shiftswifthr.co.uk/privkey.pem;

  client_max_body_size 12m;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Backend production env

Copy `backend_stub/.env.example` and set at minimum:

```bash
APP_ENV=production
APP_DOMAIN=shiftswifthr.co.uk
APP_URL=https://app.shiftswifthr.co.uk
API_URL=https://api.shiftswifthr.co.uk
MARKETING_URL=https://www.shiftswifthr.co.uk
CORS_ALLOW_ORIGINS=https://app.shiftswifthr.co.uk,https://www.shiftswifthr.co.uk,https://localhost,capacitor://localhost,ionic://localhost,http://localhost
TRUSTED_HOSTS=api.shiftswifthr.co.uk,app.shiftswifthr.co.uk,www.shiftswifthr.co.uk
FORCE_HTTPS=1
DATABASE_URL=postgresql://...
JWT_SECRET=<strong random>
ENCRYPTION_KEY=<64 hex chars>
```

Run the API with a process manager:

```bash
cd backend_stub
uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2
```

Schedule background jobs (absence alerts, template sync, notifications):

```bash
cron: */15 * * * * cd /opt/shiftswifthr && DATABASE_URL=... python scripts/run_platform_jobs.py
```

## Email addresses

Configure MX + SPF/DKIM for these (defaults in `backend_stub/brand.py`):

| Address | Use |
|---------|-----|
| `support@shiftswifthr.co.uk` | General contact & customer support |
| `legal@shiftswifthr.co.uk` | Legal / DPA |
| `noreply@shiftswifthr.co.uk` | SMTP_FROM, system mail |
| `compliance@shiftswifthr.co.uk` | Sponsor compliance alerts |
| `admin@shiftswifthr.co.uk` | Master platform admin login (local dev seed) |

## Pre-launch checklist

- [ ] DNS propagated (`dig app.shiftswifthr.co.uk`, `dig api.shiftswifthr.co.uk`)
- [ ] HTTPS valid on all four hosts
- [ ] `GET https://api.shiftswifthr.co.uk/health` returns `ok`
- [ ] `GET https://api.shiftswifthr.co.uk/setup/brand` shows correct domain URLs
- [ ] Tenant login at `https://app.shiftswifthr.co.uk/tenant-login.html`
- [ ] Production users in `app_users` — **not** dev passwords from `dev_credentials.py`
- [ ] `GEMINI_API_KEY` / Stripe keys set if using those modules
- [ ] Cron for `run_platform_jobs.py`
- [ ] RTW upload directory backed up and encrypted at rest

## Local verification

```bash
bash scripts/start_local.sh
# Tenant: http://localhost:5173/tenant-login.html
# Customer ID 1 · hr@shiftswifthr.co.uk · ShiftswiftHR-Tenant-2026
```

If `start_local.sh` fails with `.env: command not found`, quote values that contain spaces (e.g. `PROVIDER_LEGAL_NAME="Datasoftware Analytics Ltd"`).
