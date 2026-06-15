-- CRM add-on — optional prospect/customer pipeline for select tenants (Master-enabled only)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS crm_addon BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenants.crm_addon IS 'Paid add-on: sales CRM (accounts, contacts, deals pipeline) — separate from employee HR data';

CREATE TABLE IF NOT EXISTS crm_pipelines (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Sales pipeline',
  is_default BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_pipelines_tenant_default
  ON crm_pipelines (tenant_id)
  WHERE is_default;

CREATE TABLE IF NOT EXISTS crm_deal_stages (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id BIGINT NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_won BOOLEAN NOT NULL DEFAULT FALSE,
  is_lost BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pipeline_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_deal_stages_pipeline
  ON crm_deal_stages (pipeline_id, sort_order);

CREATE TABLE IF NOT EXISTS crm_accounts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  website TEXT,
  notes TEXT,
  owner_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_accounts_tenant
  ON crm_accounts (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_contacts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id BIGINT REFERENCES crm_accounts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  job_title TEXT,
  notes TEXT,
  owner_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_tenant
  ON crm_contacts (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_deals (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id BIGINT NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  stage_id BIGINT NOT NULL REFERENCES crm_deal_stages(id) ON DELETE RESTRICT,
  account_id BIGINT REFERENCES crm_accounts(id) ON DELETE SET NULL,
  contact_id BIGINT REFERENCES crm_contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  value_gbp NUMERIC(12, 2),
  expected_close_date DATE,
  notes TEXT,
  owner_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_stage
  ON crm_deals (tenant_id, stage_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_activities (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id BIGINT REFERENCES crm_deals(id) ON DELETE CASCADE,
  contact_id BIGINT REFERENCES crm_contacts(id) ON DELETE SET NULL,
  account_id BIGINT REFERENCES crm_accounts(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL DEFAULT 'note'
    CHECK (activity_type IN ('note', 'call', 'email', 'meeting')),
  subject TEXT,
  body TEXT,
  activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_deal
  ON crm_activities (tenant_id, deal_id, activity_at DESC);
