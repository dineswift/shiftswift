-- Per-location rota shifts. A location is an existing time-punch site.

ALTER TABLE rota_shifts
  ADD COLUMN IF NOT EXISTS punch_site_id BIGINT REFERENCES punch_sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rota_shifts_site_day
  ON rota_shifts (tenant_id, punch_site_id, shift_date);

COMMENT ON COLUMN rota_shifts.punch_site_id IS
  'Punch site this shift is worked at. Required when the tenant rota mode is multi_site.';

COMMENT ON COLUMN tenants.rota_multi_site_addon IS
  'Paid add-on: assign and filter the weekly rota by punch site.';
