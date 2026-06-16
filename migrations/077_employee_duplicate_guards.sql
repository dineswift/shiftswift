-- Prevent duplicate work emails among non-terminated employees (same tenant).

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_tenant_work_email
  ON employees (tenant_id, lower(btrim(email)))
  WHERE email IS NOT NULL
    AND btrim(email) <> ''
    AND status <> 'terminated';

COMMENT ON INDEX idx_employees_tenant_work_email IS
  'One active work email per tenant; terminated records may reuse an address.';
