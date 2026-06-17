-- Rapid re-punch flagging and premises QR token freshness

ALTER TABLE time_punches
  ADD COLUMN IF NOT EXISTS rapid_re_punch BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_time_punches_rapid_re_punch
  ON time_punches (tenant_id, rapid_re_punch, punched_at DESC)
  WHERE rapid_re_punch = TRUE;

ALTER TABLE punch_sites
  ADD COLUMN IF NOT EXISTS site_clock_token_issued_at TIMESTAMPTZ;

UPDATE punch_sites
SET site_clock_token_issued_at = COALESCE(updated_at, NOW())
WHERE site_clock_token IS NOT NULL
  AND site_clock_token_issued_at IS NULL;

COMMENT ON COLUMN time_punches.rapid_re_punch IS 'Clock-in within 10 minutes of a clock-out on the same day — flagged for HR review';
COMMENT ON COLUMN punch_sites.site_clock_token_issued_at IS 'When the current premises QR token was issued (rotate/reprint periodically)';
