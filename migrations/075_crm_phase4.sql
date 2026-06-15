-- CRM Phase 4 — email templates and add-on billing metadata

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS crm_addon_monthly_gbp NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS crm_addon_billing_notes TEXT;

COMMENT ON COLUMN tenants.crm_addon_monthly_gbp IS 'Agreed offline monthly price for Sales CRM add-on (ex VAT)';
COMMENT ON COLUMN tenants.crm_addon_billing_notes IS 'CRM add-on billing notes — invoice cadence, PO ref, etc.';

CREATE TABLE IF NOT EXISTS crm_email_templates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_email_templates_tenant
  ON crm_email_templates (tenant_id, template_key);
