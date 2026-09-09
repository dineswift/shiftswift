# SwiftCRM — product concept

**Legal entity:** Datasoftware Analytics Ltd (Co. 14568900)  
**Trading name:** SwiftCRM  
**Sibling products:** ShiftSwift HR (workforce) · DineSwift (hospitality ordering / EPOS)

SwiftCRM is **not** a re-skin of ShiftSwift HR and **not** a fork of DineSwift. It reuses the ShiftSwift *platform idea* (multi-tenant agency login, invoices, Direct Debit, document habits) and applies it to **housing and lettings**.

---

## Who it is for

UK letting and managing agents who currently run the desk on:

- Spreadsheets + WhatsApp for applicants
- Xero or FreeAgent for invoices (or paper)
- A separate property list in email

They need one place for **who rang, who owes, what certificate is due, and who to tell** — then post the money into Xero/FreeAgent.

## Who it is not for

- Replacing Xero/FreeAgent as a full accounts package (VAT, bank rec, MTD)
- DineSwift restaurants / tills
- ShiftSwift HR employees, clock, sponsor licence

---

## Domain model

```
Agency (SaaS customer)
  ├── Properties / units + council tax
  ├── Landlords (UTR, NRL)
  ├── Tenants (shown as "tenants" in the UI; stored as occupier so we do not clash with ShiftSwift tenant_id)
  ├── Lettings (property + tenant + landlord + AST + house file)
  ├── Inbox (tenant, landlord, supplier)
  ├── Calls (caller ID → screen-pop the letting)
  ├── Jobs (maintenance, on Today and on the letting)
  ├── House file (suppliers, insurance, compliance diary, documents)
  ├── Invoices / payments
  └── Settings (phone webhook, mail outbox, Xero queue)
```

Pipeline / applicants, portal feeds, and a second ledger are **out of the desk** until they are necessary.

The agency is the communicator. Tenant app and landlord app each see only their lettings and the updates addressed to them.

## Apps

| App | Who | Purpose |
|-----|-----|---------|
| Agency desk | Lettings agent | Record everything, message both sides |
| Tenant app | Occupier | Letting, council tax, talk to the agent |
| Landlord app | Owner | Portfolio, tenant updates, NRL/UTR on file |

---

## What we copied vs what is new

| From ShiftSwift | In SwiftCRM |
|-----------------|-------------|
| Agency login + admin shell pattern | Rewritten UI, navy/copper theme |
| CRM accounts / contacts / pipeline | Reshaped into landlords, occupiers, lettings pipeline |
| Stripe invoice + Bacs patterns | Rent invoices + collect-payment demo (GoCardless/Stripe next) |
| Document / e-sign habit | Roadmap: AST + inventory signing |
| Employees, punch, rota, RTW, grievance | **Not copied** |

DineSwift (menus, kitchen, Clover/Dojo tills) is unused.

---

## Colour and feel

ShiftSwift HR is **pine / verdant / paper** — calm compliance software.

SwiftCRM is **ink navy / copper / linen** — estate-agency desk: warmer, more editorial, serif headlines (Fraunces) and a geometric sans (Figtree). Copper CTAs, navy chrome, linen pages. Not a green HR clone.

---

## Roadmap after this slice

1. Live SIP/Twilio media (this slice matches caller ID and pops the record; it does not terminate audio)
2. GoCardless / Stripe Bacs for occupier Direct Debit
3. Live Xero OAuth (this slice queues invoices for a connector)
4. SMTP send for the mail outbox
5. Live e-sign for AST / inventory (this slice stores the file and a signed/sent flag)
6. Client money / CMP reporting (regulated — do not fake this)
