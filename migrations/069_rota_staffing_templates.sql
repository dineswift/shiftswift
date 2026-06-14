-- Advanced rota: staffing templates and weekly contract hours

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS contract_hours_weekly NUMERIC(5, 2);

COMMENT ON COLUMN employees.contract_hours_weekly IS 'Contracted weekly hours for rota warnings; NULL uses employment_type default';

CREATE TABLE IF NOT EXISTS rota_staffing_templates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rota_staffing_templates_name_check CHECK (char_length(trim(name)) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_rota_staffing_templates_tenant
  ON rota_staffing_templates (tenant_id);

CREATE TABLE IF NOT EXISTS rota_staffing_template_requirements (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id BIGINT NOT NULL REFERENCES rota_staffing_templates(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  role_label TEXT NOT NULL DEFAULT '',
  min_staff INTEGER NOT NULL DEFAULT 1 CHECK (min_staff >= 1 AND min_staff <= 50),
  CONSTRAINT rota_staffing_template_requirements_time_check CHECK (start_time <> end_time)
);

CREATE INDEX IF NOT EXISTS idx_rota_staffing_template_requirements_template
  ON rota_staffing_template_requirements (template_id, day_of_week, start_time);
