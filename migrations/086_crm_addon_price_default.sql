-- CRM add-on — standard list price £10/month ex VAT

ALTER TABLE tenants
  ALTER COLUMN crm_addon_monthly_gbp SET DEFAULT 10.00;

COMMENT ON COLUMN tenants.crm_addon_monthly_gbp IS 'Agreed monthly price for Sales CRM add-on (ex VAT) — default £10';
