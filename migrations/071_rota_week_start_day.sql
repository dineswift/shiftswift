-- Per-tenant rota week start day (Python weekday: 0=Monday … 6=Sunday)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS rota_week_start_day SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rota_week_start_day_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_rota_week_start_day_check
      CHECK (rota_week_start_day >= 0 AND rota_week_start_day <= 6);
  END IF;
END $$;

COMMENT ON COLUMN tenants.rota_week_start_day IS
  'First day of the rota week: 0=Monday … 6=Sunday (Python weekday)';

-- Week start is validated per tenant in the application layer.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'rota_weeks'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%isodow%week_start%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rota_weeks DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

COMMENT ON TABLE rota_weeks IS 'One rota per tenant per configured week (start day set on tenant)';
