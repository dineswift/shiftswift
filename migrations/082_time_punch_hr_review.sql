-- HR review / acceptance on individual clock punches

ALTER TABLE time_punches
  ADD COLUMN IF NOT EXISTS hr_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hr_reviewed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_time_punches_hr_review
  ON time_punches (tenant_id, hr_reviewed_at NULLS FIRST, punched_at DESC);

COMMENT ON COLUMN time_punches.hr_reviewed_at IS 'When HR accepted/reviewed this punch for payroll';
COMMENT ON COLUMN time_punches.hr_reviewed_by IS 'HR username who reviewed this punch';
