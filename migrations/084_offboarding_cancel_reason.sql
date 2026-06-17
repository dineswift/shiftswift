-- Offboarding workflow cancellation notes
ALTER TABLE offboarding_workflows
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

COMMENT ON COLUMN offboarding_workflows.cancellation_reason IS 'Optional reason when workflow status is cancelled';
