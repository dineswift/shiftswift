# SwiftCRM

Lettings and housing CRM for UK agencies — properties, occupiers, tenancies, rent invoices, and payment collection. Books stay in Xero or FreeAgent; SwiftCRM runs the agency desk.

Sibling of ShiftSwift HR (copied under `products/ShiftSwift`). Different product, different colour, different feel.

## Run locally

```bash
bash products/SwiftCRM/scripts/start.sh
```

| Surface | URL |
|---------|-----|
| Marketing | http://localhost:5280 |
| Agency login | http://localhost:5280/login.html |
| App | http://localhost:5280/app.html |
| API | http://localhost:3100 |
| API docs | http://localhost:3100/docs |

### Demo login

| Email | Password |
|-------|----------|
| `agency@swiftcrm.local` | `Lettings-Demo-2026` |

## What this v1 includes

- Property portfolio and unit records
- Landlords, occupiers, applicants
- Tenancies with rent and deposit
- Recurring-style rent invoices (issue, overdue, collect)
- Payment allocation (card / Bacs demo)
- Lettings pipeline (enquiry → move-in)
- Xero / FreeAgent sync **status** (connect is next)

## Concept

See [CONCEPT.md](./CONCEPT.md).
