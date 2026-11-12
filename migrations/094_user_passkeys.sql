-- WebAuthn passkeys (Face ID / Touch ID / platform authenticator) for passwordless sign-in

CREATE TABLE IF NOT EXISTS user_passkeys (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  credential_id BYTEA NOT NULL,
  public_key BYTEA NOT NULL,
  sign_count BIGINT NOT NULL DEFAULT 0,
  device_label TEXT NOT NULL DEFAULT '',
  transports TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS user_passkeys_credential_id_uq
  ON user_passkeys (credential_id);

CREATE INDEX IF NOT EXISTS user_passkeys_username_idx
  ON user_passkeys (lower(username));

COMMENT ON TABLE user_passkeys IS 'WebAuthn credentials — platform biometrics (Face ID / Touch ID) for automatic sign-in';
