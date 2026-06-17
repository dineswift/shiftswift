# Legal contracts workflow

**Draft templates — solicitor review required before production use.**

## Contract types

| ID | Document |
|----|----------|
| `msa` | Master Services Agreement |
| `dpa` | Data Processing Addendum |
| `subscription_order` | Subscription Order Form |
| `pack` | All three generated together |

Templates live in `backend_stub/contract_templates/` and can be edited anytime.

## Workflow

1. **Signup** — full legal pack auto-generated from business name, email, plan
2. **Master → Tenant → Legal** — platform ops generate packs, send signing links, track status
3. **Admin → Service agreements** — tenant read-only register (preview + status); sign via emailed link
4. **Send** — Master queues email notification + signing link (30-day token)
5. **Client signs** — `sign-contract.html?token=…` electronic signature
6. **Stored** — signed HTML appended with signature block

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/contracts/templates` | List template types |
| GET | `/contracts` | List tenant contracts (read-only) |
| POST | `/contracts/generate` | **403** — Master-only |
| GET | `/contracts/{id}` | View generated HTML |
| POST | `/contracts/{id}/send` | **403** — Master-only |
| GET | `/contracts/sign/view/{token}` | Public contract preview |
| POST | `/contracts/sign/{token}` | Submit signature |
| POST | `/contracts/{id}/upload-signed` | **403** — Master-only |

### Master API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/master/tenants/{id}/contracts/prefill` | Prefill from tenant profile |
| GET | `/master/tenants/{id}/contracts` | List tenant agreements |
| POST | `/master/tenants/{id}/contracts/generate` | Generate MSA/DPA/pack |
| POST | `/master/tenants/{id}/contracts/{cid}/send` | Email signing link |
| GET | `/master/tenants/{id}/contracts/{cid}` | Contract detail + HTML |

## Environment

```bash
PROVIDER_LEGAL_NAME=Datasoftware Analytics Ltd
PROVIDER_COMPANY_NUMBER=14568900
PROVIDER_ADDRESS=235 Charlbury Road, Nottingham, NG8 1NF
PROVIDER_EMAIL=legal@shiftswifthr.co.uk
CONTRACTS_STORAGE_DIR=/var/lib/shiftswift-hr/contracts
FRONTEND_BASE_URL=https://app.yourdomain.com
```

## Email delivery

Outbound messages are queued in the `notifications` table (`status=queued`). Connect your SMTP/worker to send signing links in production.
