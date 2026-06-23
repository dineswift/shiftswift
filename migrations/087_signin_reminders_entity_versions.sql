-- Employee sign-in reminder log + entity version history

CREATE TABLE IF NOT EXISTS signin_reminder_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  days_idle INT NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signin_reminder_employee_sent
  ON signin_reminder_log (tenant_id, employee_id, sent_at DESC);

COMMENT ON TABLE signin_reminder_log IS 'Dedupes periodic employee portal sign-in reminders per tenant.';

CREATE TABLE IF NOT EXISTS entity_versions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  version_no INT NOT NULL,
  snapshot JSONB NOT NULL,
  changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_by TEXT NOT NULL,
  changed_by_role TEXT NOT NULL,
  change_reason TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, entity_type, entity_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_entity_versions_lookup
  ON entity_versions (tenant_id, entity_type, entity_id, effective_from DESC);

COMMENT ON TABLE entity_versions IS 'Point-in-time snapshots; effective_to NULL means superseded by a newer version.';
