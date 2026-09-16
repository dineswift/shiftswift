# ShiftSwift HR — E2E smoke tests

Playwright smoke tests for the **HR Admin** portal (`admin.html`).

## Prerequisites

- Node.js 18+
- Local stack **or** running API + frontend:
  ```bash
  bash scripts/start_local.sh
  ```

Default dev HR credentials (from `backend_stub/dev_credentials.py`):

| Field | Value |
|-------|--------|
| Email | `hr@shiftswifthr.co.uk` |
| Password | `ShiftswiftHR-Tenant-2026` |

Override with `E2E_HR_USER` and `E2E_HR_PASSWORD`.

## Run

From repo root:

```bash
bash scripts/run_e2e_smoke.sh
```

CI-style run (no Postgres — `USE_DB=0` dev credentials):

```bash
bash scripts/run_e2e_ci.sh
```

Or from this folder:

```bash
npm install
npx playwright install chromium
npm test
```

## Tests

| Spec | Covers |
|------|--------|
| `tests/admin-smoke.spec.ts` | Business login → overview, employees hash, settings documents |

## Environment

| Variable | Default |
|----------|---------|
| `E2E_BASE_URL` | `http://127.0.0.1:5173` |
| `E2E_API_URL` | `http://127.0.0.1:3000` |
| `E2E_SKIP_WEBSERVER` | Set `1` when servers already running |
