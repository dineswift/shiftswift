-- Per-tenant clock display mode: always store punched_at; optionally hide minute-level times in UI.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS punch_time_mode TEXT NOT NULL DEFAULT 'timestamped';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_punch_time_mode_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_punch_time_mode_check
      CHECK (punch_time_mode IN ('timestamped', 'presence_only'));
  END IF;
END $$;

COMMENT ON COLUMN tenants.punch_time_mode IS
  'timestamped = show exact clock times; presence_only = attendance/presence UI (punched_at still stored for audit/payroll)';
