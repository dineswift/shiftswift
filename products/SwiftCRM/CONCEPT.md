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

They need one place for **properties, people, tenancies, rent, and arrears** — then post the money into Xero/FreeAgent.

## Who it is not for

- Replacing Xero/FreeAgent as a full accounts package (VAT, bank rec, MTD)
- DineSwift restaurants / tills
- ShiftSwift HR employees, clock, sponsor licence

---

## Domain model (v1)

```
Agency (SaaS customer)
  ├── Properties / units
  ├── Contacts
  │     ├── Landlord
  │     ├── Occupier  (never called "tenant" in code — that word is the SaaS agency)
  │     ├── Applicant
  │     └── Guarantor
  ├── Tenancies (property + occupier + rent + deposit + AST dates)
  ├── Invoices (rent, fees, arrears statements)
  ├── Payments (card / Bacs mandate → allocate to invoice)
  └── Pipeline deals (enquiry → viewing → offer → referencing → move-in)
```

**Naming rule:** `agency_id` is the SaaS customer. Occupiers are `occupiers`. This avoids colliding with ShiftSwift’s `tenant_id`.

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

1. Recurring rent schedules (rent due day → auto invoice)
2. GoCardless / Stripe Bacs for occupier Direct Debit
3. One-way Xero invoice + payment sync (FreeAgent second)
4. Occupier portal (rent due, payment link)
5. Compliance diary (gas, EICR, EPC)
6. Client money / CMP reporting (regulated — do not fake this)
