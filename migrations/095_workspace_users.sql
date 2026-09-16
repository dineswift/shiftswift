-- Workspace users — multi-role HR access (separate from employee portal accounts)

ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS invited_by TEXT,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_check;
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_check
  CHECK (role IN (
    'owner',
    'hr_manager',
    'general_manager',
    'supervisor',
    'document_manager'
  ));

COMMENT ON TABLE tenant_users IS
  'Workspace sign-in users (HR admin portal) — roles and access separate from employees table';

-- First HR account per tenant becomes owner
INSERT INTO tenant_users (tenant_id, username, role, is_active)
SELECT u.tenant_id, u.username, 'owner', TRUE
FROM app_users u
WHERE u.role = 'hr'
  AND COALESCE(u.login_portal, 'business') = 'business'
  AND u.is_active = TRUE
ON CONFLICT (tenant_id, username) DO NOTHING;
