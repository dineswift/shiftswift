-- Remember trusted devices — skip MFA for a period after a successful code entry

CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  device_label TEXT,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS mfa_trusted_devices_token_hash_uq
  ON mfa_trusted_devices (device_token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS mfa_trusted_devices_username_idx
  ON mfa_trusted_devices (lower(username))
  WHERE revoked_at IS NULL;

COMMENT ON TABLE mfa_trusted_devices IS 'Device trust tokens — skip TOTP MFA until expires_at';
