-- Rota add-ons — billed separately from the HR platform plan (pricing TBD)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS rota_advanced_addon BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rota_multi_site_addon BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenants.rota_advanced_addon IS 'Paid add-on: templates, coverage gaps, hours warnings, generate draft';
COMMENT ON COLUMN tenants.rota_multi_site_addon IS 'Paid add-on: per-location rotas (future roll-out)';
