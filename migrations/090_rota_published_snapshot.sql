-- Snapshot of last published shifts — used to notify only affected staff on rota updates.

ALTER TABLE rota_weeks
  ADD COLUMN IF NOT EXISTS published_shift_snapshot JSONB;

COMMENT ON COLUMN rota_weeks.published_shift_snapshot IS
  'Normalized shift list from the last publish; diffed on re-publish to target notifications.';
