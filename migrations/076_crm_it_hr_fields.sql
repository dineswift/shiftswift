-- CRM — IT services, HR software, and broader B2B fields

ALTER TABLE crm_accounts
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'prospect';

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS department TEXT;

ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS deal_category TEXT NOT NULL DEFAULT 'general';

COMMENT ON COLUMN crm_accounts.industry IS 'Sector or vertical — e.g. IT, HR, hospitality, finance';
COMMENT ON COLUMN crm_accounts.account_type IS 'prospect | customer | partner';
COMMENT ON COLUMN crm_contacts.department IS 'Contact department — e.g. IT, HR, Finance';
COMMENT ON COLUMN crm_deals.deal_category IS 'Deal type — IT services, HR software, consulting, etc.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_accounts_account_type_check'
  ) THEN
    ALTER TABLE crm_accounts
      ADD CONSTRAINT crm_accounts_account_type_check
      CHECK (account_type IN ('prospect', 'customer', 'partner'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_deals_deal_category_check'
  ) THEN
    ALTER TABLE crm_deals
      ADD CONSTRAINT crm_deals_deal_category_check
      CHECK (deal_category IN (
        'general', 'it_services', 'hr_software', 'consulting',
        'support_contract', 'hospitality', 'other'
      ));
  END IF;
END $$;

ALTER TABLE crm_activities DROP CONSTRAINT IF EXISTS crm_activities_activity_type_check;
ALTER TABLE crm_activities ADD CONSTRAINT crm_activities_activity_type_check
  CHECK (activity_type IN ('note', 'call', 'email', 'meeting', 'demo'));

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant_category
  ON crm_deals (tenant_id, deal_category);
