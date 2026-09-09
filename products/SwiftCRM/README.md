# SwiftCRM

Lettings CRM for a **1–3 person UK letting agency**: who rang, who owes, what is due, who to tell.

The desk has five jobs. Everything else lives inside a letting.

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

## The five jobs

1. **Today** — arrears, certificates due, open jobs, latest updates, incoming call
2. **Lettings** — property + tenant + landlord + tenancy + house file in one record
3. **Inbox** — tenant / landlord / supplier
4. **Money** — invoices and payments, then a Xero queue
5. **Settings** — agency, telephone webhook, mail outbox, accounting queue

Not in the sidebar (on purpose): sales pipeline, portal feeds, a second accounts pack, AI tools, block management.

## Inside a letting

- People (joint occupiers, landlord, click-to-call)
- Council tax and landlord NRL / UTR
- Thread, jobs, rent on this letting
- **House file** — suppliers (gas, electricity, maintenance, insurance), policies, compliance diary, document uploads

Vacant units still have a house file from the lettings list.

## Telephone

The desk polls `GET /telephony/active`. When a call is ringing, an overlay shows the matched tenant/landlord, letting, and arrears, then **Open letting**.

Point a PBX/Twilio voice webhook at:

```
POST http://localhost:3100/telephony/inbound
```

Form or JSON fields: `From`, `To`, `CallSid`. UK numbers are normalised to E.164 and matched to `contacts.phone_e164`.

Demo: **Incoming call** on the agency top bar rings Hannah Reid (`07700 900111`). Settings can ring Luca (arrears), Elise (joint tenant), or an unknown number.

## Honest gaps

Live SIP/Twilio audio, SMTP send, GoCardless, Xero OAuth, CMP/client money, live e-sign, AML/referencing, and portal feeds are **not** connected. The desk records the work; it does not fake a regulated product.

See [CONCEPT.md](./CONCEPT.md).
