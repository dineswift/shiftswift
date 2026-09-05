-- Pilot tenant: Himalayan Inn contact / subscription email → info@himalayaninn.com
-- Idempotent. Does not overwrite a distinct signatory address. Stripe customer email
-- is not updated here (billing portal / Stripe dashboard if the customer still uses .co.uk).

DO $$
DECLARE
  new_email TEXT := 'info@himalayaninn.com';
  old_email TEXT := 'info@himalayaninn.co.uk';
BEGIN
  UPDATE tenants
  SET
    billing_email = new_email,
    signatory_email = CASE
      WHEN signatory_email IS NULL
        OR btrim(signatory_email) = ''
        OR lower(signatory_email) IN (lower(old_email), lower(coalesce(billing_email, '')))
      THEN new_email
      ELSE signatory_email
    END
  WHERE deleted_at IS NULL
    AND (
      lower(name) LIKE '%himalayan inn%'
      OR lower(coalesce(trading_name, '')) LIKE '%himalayan inn%'
      OR lower(coalesce(billing_email, '')) IN (lower(old_email), lower(new_email))
    );

  UPDATE app_users u
  SET username = new_email,
      updated_at = NOW()
  FROM tenants t
  WHERE u.tenant_id = t.id
    AND u.role = 'hr'
    AND lower(u.username) = lower(old_email)
    AND t.deleted_at IS NULL
    AND (
      lower(t.name) LIKE '%himalayan inn%'
      OR lower(coalesce(t.trading_name, '')) LIKE '%himalayan inn%'
      OR lower(coalesce(t.billing_email, '')) IN (lower(old_email), lower(new_email))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM app_users other
      WHERE lower(other.username) = lower(new_email)
        AND other.id <> u.id
    );

  UPDATE tenant_contracts c
  SET signatory_email = new_email
  FROM tenants t
  WHERE c.tenant_id = t.id
    AND t.deleted_at IS NULL
    AND lower(c.signatory_email) = lower(old_email)
    AND c.status IN ('draft', 'generated', 'sent')
    AND (
      lower(t.name) LIKE '%himalayan inn%'
      OR lower(coalesce(t.trading_name, '')) LIKE '%himalayan inn%'
      OR lower(coalesce(t.billing_email, '')) IN (lower(old_email), lower(new_email))
    );
END $$;
