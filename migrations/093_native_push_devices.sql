-- Native push device tokens (FCM on Android, APNs on iOS) for Capacitor apps

CREATE TABLE IF NOT EXISTS native_push_devices (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  device_token TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, platform, device_token)
);

CREATE INDEX IF NOT EXISTS idx_native_push_devices_tenant_employee
  ON native_push_devices (tenant_id, employee_id);
