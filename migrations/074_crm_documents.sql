-- CRM Phase 3 — file attachments on companies, contacts, and deals

CREATE TABLE IF NOT EXISTS crm_documents (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id BIGINT REFERENCES crm_accounts(id) ON DELETE CASCADE,
  contact_id BIGINT REFERENCES crm_contacts(id) ON DELETE CASCADE,
  deal_id BIGINT REFERENCES crm_deals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_filename TEXT,
  storage_path TEXT NOT NULL,
  content_type TEXT,
  file_size_bytes BIGINT,
  content_sha256 TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crm_documents_single_entity CHECK (
    (CASE WHEN account_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN contact_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN deal_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_crm_documents_account
  ON crm_documents (tenant_id, account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_documents_contact
  ON crm_documents (tenant_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_documents_deal
  ON crm_documents (tenant_id, deal_id, created_at DESC);
