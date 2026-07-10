-- Native push device tokens for business admin / HR accounts (Capacitor)

CREATE TABLE IF NOT EXISTS admin_native_push_devices (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  device_token TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, username, platform, device_token)
);

CREATE INDEX IF NOT EXISTS idx_admin_native_push_devices_tenant_user
  ON admin_native_push_devices (tenant_id, username);
