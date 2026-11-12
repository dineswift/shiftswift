-- Per-business sign-in code. On for every tenant unless master turns it off.
-- Apple review and existing demo businesses start with the code off.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS login_mfa_required BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE tenants
SET login_mfa_required = FALSE
WHERE lower(billing_email) = 'apple-review@shiftswifthr.co.uk'
   OR lower(name) ~ '(^|[^a-z0-9])demo([^a-z0-9]|$)'
   OR lower(coalesce(billing_email, '')) ~ '(^|[^a-z0-9])demo([^a-z0-9]|$)';

UPDATE tenants t
SET login_mfa_required = FALSE
FROM app_users u
WHERE u.tenant_id = t.id
  AND lower(u.username) = 'apple-review@shiftswifthr.co.uk';
