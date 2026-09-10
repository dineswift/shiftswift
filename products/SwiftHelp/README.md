# SwiftHelp

IT helpdesk for a small office: who raised it, which device, what is due, who to tell.

A **sibling** of SwiftCRM (lettings) and ShiftSwift HR. Not a mode inside either.

## Install on this machine

```bash
SWIFTHELP_RESET=1 bash products/SwiftHelp/scripts/install_local.sh
bash products/SwiftHelp/scripts/start.sh
```

| App | URL | Demo login |
|-----|-----|------------|
| IT desk | http://localhost:5380/app.html | `it@swifthelp.local` / `Helpdesk-Demo-2026` |
| Staff portal | http://localhost:5380/request.html | `amira.khan@northgate.example` / `Request-Demo-2026` |
| API | http://localhost:3200/docs | — |

Ports **3200** (API) and **5380** (app) so it can run next to SwiftCRM (3100 / 5280).

## Five jobs

1. **Today** — P1s, SLA due, waiting on the user
2. **Tickets** — requester + asset + thread
3. **Assets** — laptops, phones, printers
4. **Inbox** — updates to the requester
5. **Settings**

SLA clocks are simple (P1 4h, P2 1 day, P3 3 days). Not ServiceNow.

See [CONCEPT.md](./CONCEPT.md).
