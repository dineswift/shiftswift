# ShiftSwift HR · shiftswifthr.co.uk

UK HR software with sponsor licence safeguards (RTW, day-9 absence alerts, SMS reporting, grievance, audit export).

## Fresh local install (recommended)

Drops the local database and rebuilds from scratch — not an upgrade path.

```bash
bash scripts/fresh_install.sh
# or
bash scripts/install_local.sh
```

## Start locally

```bash
bash scripts/start_local.sh
```

## Production domains

| Service | URL |
|---------|-----|
| Marketing | https://www.shiftswifthr.co.uk |
| App / admin | https://app.shiftswifthr.co.uk |
| API | https://api.shiftswifthr.co.uk |

Contact: support@shiftswifthr.co.uk · legal@shiftswifthr.co.uk

## Native iOS apps (App Store)

Capacitor shells — same UI as the PWAs. See [docs/native_ios_apps.md](docs/native_ios_apps.md) and [mobile/README.md](mobile/README.md).

```bash
cd mobile && npm install && npm run ios:setup
npm run ios:employee:open   # or ios:business:open
```

## Production

- [Production readiness checklist](docs/production_readiness.md)
- [Server installation](docs/server_installation.md)
- [CloudPanel / Hostinger zips](deploy/cloudpanel/INSTALL-API.md)
- [Cyber Essentials readiness](docs/cyber_essentials_readiness.md)

### Build upload zips (Hostinger CloudPanel)

```bash
python3 scripts/build_cloudpanel_zips.py
# Output: deploy/cloudpanel/dist/shiftswifthr-api.zip
#         deploy/cloudpanel/dist/shiftswifthr-frontend.zip
```

## Local URLs

| Page | URL |
|------|-----|
| Marketing | http://localhost:5173/index.html |
| Business login | http://localhost:5173/business-login.html |
| Admin console | http://localhost:5173/admin.html |
| API home (branded) | http://localhost:3000/ |
| API login (same UI) | http://localhost:3000/app/business-login.html |
| API docs | http://localhost:3000/docs |
| API health | http://localhost:3000/health |
| Brand config | http://localhost:3000/setup/brand |

### Local credentials (development only)

| Portal | Business ID | Username | Password |
|--------|-------------|----------|----------|
| Business HR | `1` | `hr@shiftswifthr.co.uk` | `ShiftswiftHR-Tenant-2026` |
| Employee | — | `employee@shiftswifthr.co.uk` | `ShiftswiftHR-Employee-2026` |
| Master admin | `999` | `admin@shiftswifthr.co.uk` | `ShiftswiftHR-Platform-2026` |

Legacy accounts (`demo`, `admin`, `hr`) are removed on seed. Override via `DEV_TENANT_USERNAME`, `DEV_TENANT_PASSWORD`, `DEV_MASTER_USERNAME`, and `DEV_MASTER_PASSWORD` in `.env` if needed.

### Docs

- DNS & hosting: `docs/dns_hosting.md`
- Backend setup: `docs/backend_setup_guide.md`
- Sponsor licence backlog: `docs/sponsor_licence_backlog.md`
- B2B billing: `docs/b2b_stripe_billing_guide.md`
- Brand kit: `docs/shiftswift-hr-brand-kit.html`

