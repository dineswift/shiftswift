# SwiftCRM

Lettings CRM for UK agencies that sit between **landlords and tenants**: record lettings, talk to both sides, keep local tax on file, then collect rent.

## Install on this machine

```bash
SWIFTCRM_RESET=1 bash products/SwiftCRM/scripts/install_local.sh
bash products/SwiftCRM/scripts/start.sh
```

| App | URL | Demo login |
|-----|-----|------------|
| Agency desk | http://localhost:5280/app.html | `agency@swiftcrm.local` / `Lettings-Demo-2026` |
| Tenant app | http://localhost:5280/tenant.html | `hannah.reid@example.com` / `Tenant-Demo-2026` |
| Landlord app | http://localhost:5280/landlord.html | `priya@mapperleyholdings.example` / `Landlord-Demo-2026` |
| API | http://localhost:3100/docs | — |

On a phone, open the tenant or landlord URL and use **Add to Home Screen** — each has a standalone web-app manifest.

## What the desk records

- **Lettings** — tenant + landlord + property + rent + deposit scheme
- **Tenants** and **landlords** as separate people (the agency is the go-between)
- **Updates** — email / SMS / phone / portal, addressed to tenant, landlord, or both
- **Local tax** — council tax band, authority, account, who is liable; landlord UTR and NRL
- Rent invoices and payment collection (Xero/FreeAgent connect still next)

See [CONCEPT.md](./CONCEPT.md).
