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

- **Lettings** — tenant + landlord + property + rent + deposit scheme (joint occupiers, end a letting)
- **Tenants** and **landlords** as separate people (the agency is the go-between)
- **Telephone** — inbound caller ID screen-pop (Twilio-shaped `POST /telephony/inbound`), click-to-call, demo ring from the desk
- **Jobs** — maintenance raised from the desk or from an inbound call
- **Updates** — email / SMS / phone / portal, addressed to tenant, landlord, or both (email lands in the mail outbox)
- **Local tax** — council tax band, authority, account, who is liable; landlord UTR and NRL
- Rent invoices (generate a month's rent), fake Bacs collect, Xero export queue

See [CONCEPT.md](./CONCEPT.md).

## Telephone

The desk polls `GET /telephony/active`. When a call is ringing, an overlay shows the matched tenant/landlord, letting, and arrears.

Point a PBX/Twilio voice webhook at:

```
POST http://localhost:3100/telephony/inbound
```

Form or JSON fields: `From`, `To`, `CallSid`. UK numbers are normalised to E.164 and matched to `contacts.phone_e164`.

Demo: **Incoming call** on the agency top bar rings Hannah Reid (`07700 900111`). Settings can ring Luca (arrears), Elise (joint tenant), or an unknown number.
