-- Short-lived email OTP codes for login MFA (default second factor after password)

CREATE TABLE IF NOT EXISTS mfa_email_codes (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  challenge_jti TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mfa_email_codes_username_active_idx
  ON mfa_email_codes (lower(username), expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mfa_email_codes_challenge_jti_active_uq
  ON mfa_email_codes (challenge_jti)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE mfa_email_codes IS 'Hashed email OTP codes tied to an MFA challenge JWT (jti)';
