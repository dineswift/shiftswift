-- AI document assistant add-on — billed separately (£10/mo default ex VAT)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_document_addon BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_document_addon_monthly_gbp NUMERIC(12, 2) DEFAULT 10.00;

COMMENT ON COLUMN tenants.ai_document_addon IS 'Paid add-on: AI drafting for HR process templates';
COMMENT ON COLUMN tenants.ai_document_addon_monthly_gbp IS 'Agreed monthly price for AI document add-on (ex VAT)';
