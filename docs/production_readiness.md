# Production readiness — ShiftSwift HR

Checklist for going live on **shiftswifthr.co.uk** with real customer data. Use **staging first**, then production.

**Related docs:** [server_installation.md](./server_installation.md) · [cyber_essentials_readiness.md](./cyber_essentials_readiness.md) · [b2b_launch_checklist.md](./b2b_launch_checklist.md)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Implemented in repo |
| ⚠️ | Partial — complete before real customers |
| ❌ | Not done yet |
| 🔁 | Ongoing (monthly/quarterly) |

---

## 1. Blockers (must be green before launch)

- [ ] **All migrations applied** (through `084_offboarding_cancel_reason.sql`)
  ```bash
  DATABASE_URL=postgresql://... bash scripts/run_migrations.sh
  ```
  Includes time punch QR/kiosk (`063`–`064`), employee GDPR consent (`055`), master platform ops (`065`), punch state flags (`082`–`083`).
- [ ] **Strong secrets** — `JWT_SECRET` ≥ 32 characters, `ENCRYPTION_KEY` set (64 hex chars for grievance module)
  ```bash
  bash scripts/generate_secrets.sh
  # Review backend_stub/.env.production.example → copy to backend_stub/.env on server
  ```
- [ ] **Dev credentials removed or rotated** — change `DEV_*` passwords; do not use seeded demo passwords in production
- [ ] **HTTPS everywhere** — TLS on nginx/Caddy; `FORCE_HTTPS=1`; `CORS_ALLOW_ORIGINS` uses `https://` only
- [ ] **Production env boots cleanly** — `APP_ENV=production` with weak JWT must **fail** (see `config.py`)
- [ ] **Database backups** — daily automated Postgres backup
- [ ] **Restore test documented** — restore a backup to staging and verify login works
- [ ] **Privacy notice live** on www (solicitor-reviewed)
- [ ] **MSA + DPA signed** with customers (see `docs/hr_msa_outline.md`, `docs/hr_dpa_outline.md`)
- [ ] **Stripe live mode** (if billing at launch) — live keys, webhook secret, VAT/tax configured
- [ ] **Marketing honesty** — no template testimonials; UI mocks labelled; claims match shipped features ([go_to_market_credibility.md](./go_to_market_credibility.md))

### Pre-flight (run on staging)

```bash
bash scripts/generate_secrets.sh
bash scripts/run_migrations.sh
python3 scripts/seed_app_users.py          # staging only
python3 scripts/seed_time_punch.py         # optional demo data
bash scripts/security_audit.sh
cd backend_stub && python -m pytest tests/ -q
curl -s http://127.0.0.1:8000/health
```

---

## 2. Security

| Item | Status | Notes |
|------|--------|-------|
| Bcrypt password hashing | ✅ | `auth_service.py` |
| JWT access + refresh tokens | ✅ | Default 60 min / 7 days |
| Login rate limiting | ✅ | 10 attempts / 15 min per IP + username |
| TOTP 2FA (in-app) | ✅ | Migration `034`; HR required in production (`BUSINESS_REQUIRE_MFA`); master OPS at `/ops-9x7k2.html` |
| Separate Master / Business / Employee login | ✅ | Portal isolation |
| Tenant isolation (`X-Tenant-Id` + JWT) | ✅ | All admin routes |
| Security headers (HSTS, nosniff, frame deny) | ✅ | `security_middleware.py` |
| Trusted hosts | ✅ | `TRUSTED_HOSTS` in production `.env` |
| Upload size / type limits | ✅ | RTW PDFs, `MAX_UPLOAD_BYTES` |
| Grievance note encryption | ✅ | Requires `ENCRYPTION_KEY` |
| Security audit logging | ✅ | `security_audit_events` |
| Employee data audit log | ⚠️ | Ensure all employee CRUD paths call `log_employee_data_event()` |
| API docs hidden in production | ✅ | Swagger disabled when `APP_ENV=production` |
| Dependency CVE scan | ⚠️ | `bash scripts/security_audit.sh` — run 🔁 monthly |
| Rate limit with multiple workers | ⚠️ | In-memory limiter — use Redis or single worker until shared store added |
| Secrets not in git | ⚠️ | Confirm `.env` gitignored; use `chmod 600` on server |
| Postgres SSL in production | ❌ | Use `?sslmode=require` on managed databases |

### Post-launch security (recommended)

- [ ] WAF or Cloudflare in front of API
- [ ] `pip audit` in CI on every deploy
- [ ] MFA on cloud admin email (Microsoft 365 / Google Workspace)
- [ ] EPOS integration tokens (Phase 2) — separate from employee JWT

---

## 3. Performance and reliability

| Item | Status | Action |
|------|--------|--------|
| Postgres indexes on hot paths | ⚠️ | Review `time_punches`, `employees(tenant_id)`, login queries |
| Connection pooling | ❌ | PgBouncer or managed DB pool at scale |
| Uvicorn workers (not `--reload`) | ✅ | `deploy/shiftswift-api.service` uses `--workers 2` |
| Static frontend via nginx | ✅ | `deploy/nginx-shiftswift.conf` |
| Health check | ✅ | `GET /health` — wire to uptime monitor |
| Error monitoring (Sentry, etc.) | ❌ | Catch 500s in production |
| Log aggregation | ❌ | `/var/log/shiftswift-hr/` — rotate and monitor |
| Geocoding for time punch | ⚠️ | Coords stored on `punch_sites`; avoid repeated Nominatim calls |

**Capacity note:** A single modest VPS (2 uvicorn workers, tuned Postgres) is sufficient for hundreds of businesses and thousands of employees — typical UK SMB HR SaaS scale.

---

## 4. HR product and compliance

| Feature | Status | Verify before launch |
|---------|--------|----------------------|
| Business / Employee / Master login | ✅ | Smoke-test all portals |
| Employee CRUD | ✅ | HR admin workflow |
| Time punch + geofence | ✅ | Real phone GPS at punch site |
| Sponsor compliance (RTW, absences) | ✅ | Upload + audit export |
| Grievance (encrypted notes) | ✅ | RBAC + encryption key set |
| Offboarding / ACAS | ✅ | Spot-check deadlines |
| B2B billing / trial | ⚠️ | End-to-end Stripe test checkout |
| HR templates + AI | ⚠️ | Set `AI_ENABLED=0` if no API key |
| SMTP notifications | ✅ | Password reset + signup mail — verify Brevo on each deploy |
| GDPR retention / deletion process | ⚠️ | Operational process beyond code |
| RTW immutable storage backup | ❌ | Backup `RTW_STORAGE_DIR` with database |
| DineSwift EPOS punch integration | ❌ | Phase 2 — optional at HR-only launch |

---

## 5. Deployment and operations

| Item | Status | Notes |
|------|--------|-------|
| Server install script | ✅ | `scripts/install_server.sh` |
| nginx + systemd units | ✅ | `deploy/nginx-shiftswift.conf`, `deploy/shiftswift-api.service` |
| DNS (www, app, api) | ❌ | A/AAAA records to server |
| TLS (Let's Encrypt) | ❌ | `certbot --nginx -d www... -d app... -d api...` |
| Staging environment | ❌ | Mirror prod with test Stripe |
| Rollback plan | ❌ | DB snapshot + previous release tag |
| Support process | ❌ | support@shiftswifthr.co.uk P1 runbook |

**Target architecture:**

```
Browser → nginx (TLS)
            ├── app.shiftswifthr.co.uk  → /opt/shiftswifthr/frontend/
            └── api.shiftswifthr.co.uk  → uvicorn :8000 (2 workers) → PostgreSQL
```

See [server_installation.md](./server_installation.md) for step-by-step staging setup.

---

## 6. Testing before launch

- [ ] `cd backend_stub && python -m pytest tests/ -q`
- [ ] Business HR login + MFA enrollment (Settings → Security after login)
- [ ] Employee login → time punch (GPS, premises QR, or kiosk if enabled)
- [ ] Master OPS login at `/ops-9x7k2.html` — tenant list, duplicate trial cleanup
- [ ] Master login blocked on business portal (and vice versa)
- [ ] Tenant isolation — forged `X-Tenant-Id` returns 403
- [ ] Signup blocks duplicate billing email; OPS shows Primary vs Duplicate trial
- [ ] RTW PDF upload + audit entry
- [ ] Stripe webhook (test mode) updates subscription
- [ ] `APP_ENV=production` rejects weak `JWT_SECRET` on startup
- [ ] Backup restore to staging succeeds

---

## 7. Legal and commercial

- [ ] MSA (HR-specific, separate from EPOS) — `docs/hr_msa_outline.md`
- [ ] DPA (data silo clause) — `docs/hr_dpa_outline.md`
- [ ] Privacy policy on marketing site
- [ ] Payment / refund terms — `docs/b2b_payment_terms.md`
- [ ] Cyber Essentials organisational controls — `docs/cyber_essentials_readiness.md`
- [ ] ICO registration current (annual fee)
- [ ] **Compliance checklist** — `docs/compliance_checklist.md`
- [ ] Cyber / professional indemnity insurance

---

## 8. Recommended launch timeline

| Week | Focus |
|------|--------|
| **1** | Staging server, HTTPS, migrations, secrets, disable dev passwords |
| **2** | Pilot with one friendly business; fix bugs; configure SMTP |
| **3** | Backups, uptime monitoring, legal pages live |
| **4** | Stripe live, first paying customer, post-launch watch |

---

## 9. Scorecard (quick view)

| Area | Ready? |
|------|--------|
| Core HR software (Python / FastAPI) | ✅ |
| Security foundations | ✅ — finish HTTPS, secrets, MFA migration |
| Production hosting | ❌ main gap |
| Legal / commercial | ⚠️ drafts only |
| Observability and backups | ❌ must add before scale |

---

## 10. Highest-impact next steps

1. Provision **staging VPS** and run `sudo bash scripts/install_server.sh`
2. Point **DNS** and run **certbot**
3. Apply **all migrations** through **`065`** (MFA `034`, time punch `035`–`064`, master ops `065`)
4. **Rotate secrets** and change seeded passwords
5. Configure **daily Postgres backup** (DB + document/RTW upload dirs) and test restore
6. Add **uptime monitor** on `https://api.shiftswifthr.co.uk/health`
7. **Pilot one real business** — HR login + 2FA, employee invite, time punch; tidy duplicate trials in OPS if needed

---

## 11. Marketing credibility (before paid acquisition)

See **[go_to_market_credibility.md](./go_to_market_credibility.md)** for the full checklist.

| Item | Status |
|------|--------|
| Template customer quotes removed | ✅ |
| Product previews labelled (not “demo business”) | ✅ |
| Feature claims match codebase (no fake rota/RTI) | ✅ |
| Real admin screenshots on homepage | ❌ |
| First named case study with permission | ❌ |
| Stripe live checkout verified | ⚠️ |

---

*Last updated: June 2026 — review after each major release.*
