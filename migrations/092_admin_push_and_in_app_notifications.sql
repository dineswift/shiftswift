-- HR admin Web Push subscriptions + in-app notification feed (HR + employees)

CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, username, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_admin_push_subscriptions_tenant_user
  ON admin_push_subscriptions (tenant_id, username);

CREATE TABLE IF NOT EXISTS admin_push_notification_log (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  notification_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, username, notification_key)
);

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('hr', 'employee')),
  recipient_username TEXT NOT NULL,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  alert_type TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_recipient
  ON in_app_notifications (tenant_id, audience, recipient_username, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_unread
  ON in_app_notifications (tenant_id, audience, recipient_username)
  WHERE read_at IS NULL;
