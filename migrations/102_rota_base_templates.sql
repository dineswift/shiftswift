-- Named base rotas: a week's actual shifts, reusable as an editable draft.

CREATE TABLE IF NOT EXISTS rota_base_templates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rota_base_templates_name_check CHECK (char_length(btrim(name)) >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rota_base_templates_tenant_name
  ON rota_base_templates (tenant_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS rota_base_template_shifts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id BIGINT NOT NULL REFERENCES rota_base_templates(id) ON DELETE CASCADE,
  day_offset SMALLINT NOT NULL CHECK (day_offset BETWEEN 0 AND 6),
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  role_label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  punch_site_id BIGINT REFERENCES punch_sites(id) ON DELETE SET NULL,
  CONSTRAINT rota_base_template_shifts_time_check CHECK (start_time <> end_time)
);

CREATE INDEX IF NOT EXISTS idx_rota_base_template_shifts_template
  ON rota_base_template_shifts (template_id, day_offset, start_time);

COMMENT ON TABLE rota_base_templates IS 'Named copy of a real rota week. Loading it creates a draft on another week.';
