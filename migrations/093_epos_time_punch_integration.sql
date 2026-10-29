-- EPOS / till integration tokens and punch audit fields

CREATE TABLE IF NOT EXISTS epos_integration_tokens (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  punch_site_id   BIGINT NOT NULL REFERENCES punch_sites(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  token_prefix    VARCHAR(16) NOT NULL,
  token_hash      TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  revoked_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_epos_tokens_tenant
  ON epos_integration_tokens (tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_epos_tokens_prefix
  ON epos_integration_tokens (token_prefix)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS epos_integration_audit_log (
  id                    BIGSERIAL PRIMARY KEY,
  tenant_id             BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_token_id  BIGINT REFERENCES epos_integration_tokens(id) ON DELETE SET NULL,
  event_type            TEXT NOT NULL,
  employee_id           BIGINT REFERENCES employees(id) ON DELETE SET NULL,
  external_ref          TEXT,
  ip_address            TEXT,
  detail                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epos_audit_tenant_created
  ON epos_integration_audit_log (tenant_id, created_at DESC);

ALTER TABLE time_punches
  ADD COLUMN IF NOT EXISTS external_ref TEXT,
  ADD COLUMN IF NOT EXISTS integration_token_id BIGINT REFERENCES epos_integration_tokens(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_time_punches_epos_idempotency
  ON time_punches (integration_token_id, external_ref)
  WHERE external_ref IS NOT NULL AND integration_token_id IS NOT NULL;

ALTER TABLE time_punches DROP CONSTRAINT IF EXISTS time_punches_punch_method_check;
ALTER TABLE time_punches ADD CONSTRAINT time_punches_punch_method_check
  CHECK (punch_method IN ('gps', 'site_qr', 'admin', 'kiosk', 'epos'));

COMMENT ON TABLE epos_integration_tokens IS 'Bearer tokens for EPOS/till clock punch API (one per site or till)';
COMMENT ON TABLE epos_integration_audit_log IS 'Audit trail for EPOS punch attempts and token lifecycle';
COMMENT ON COLUMN time_punches.external_ref IS 'EPOS idempotency / correlation id';
COMMENT ON COLUMN time_punches.integration_token_id IS 'EPOS integration token used for this punch';
