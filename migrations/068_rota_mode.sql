-- Tenant preference for rota scheduling tier (effective mode also depends on subscription plan)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS rota_mode TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rota_mode_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_rota_mode_check
      CHECK (rota_mode IS NULL OR rota_mode IN ('basic', 'advanced', 'multi_site'));
  END IF;
END $$;

COMMENT ON COLUMN tenants.rota_mode IS 'HR preference: basic | advanced | multi_site — requires purchased rota add-ons';
