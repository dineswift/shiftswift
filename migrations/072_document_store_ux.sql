-- Document store UX: expiry alerts, employee visibility, categories, active lifecycle stage

ALTER TABLE tenant_documents
  ADD COLUMN IF NOT EXISTS expiry_alert_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS employee_visible BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS expiry_alert_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS employee_visible BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE tenant_documents DROP CONSTRAINT IF EXISTS tenant_documents_expiry_alert_days_check;
ALTER TABLE tenant_documents ADD CONSTRAINT tenant_documents_expiry_alert_days_check
  CHECK (expiry_alert_days IN (30, 60, 90));

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_expiry_alert_days_check;
ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_expiry_alert_days_check
  CHECK (expiry_alert_days IN (30, 60, 90));

ALTER TABLE tenant_documents DROP CONSTRAINT IF EXISTS tenant_documents_lifecycle_stage_check;
ALTER TABLE tenant_documents ADD CONSTRAINT tenant_documents_lifecycle_stage_check
  CHECK (lifecycle_stage IN (
    'recruitment', 'onboarding', 'induction', 'document_store', 'compliance',
    'offboarding', 'general', 'policy', 'active'
  ));

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_lifecycle_stage_check;
ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_lifecycle_stage_check
  CHECK (lifecycle_stage IN (
    'recruitment', 'onboarding', 'induction', 'document_store', 'compliance',
    'offboarding', 'general', 'active'
  ));

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_category_check;
ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_category_check
  CHECK (category IN (
    'general', 'contract', 'id', 'rtw', 'qualification', 'disciplinary', 'policy',
    'other', 'payslip', 'visa_brp', 'dbs', 'training'
  ));

CREATE INDEX IF NOT EXISTS idx_tenant_documents_expires
  ON tenant_documents (tenant_id, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_documents_expires
  ON employee_documents (tenant_id, expires_at)
  WHERE expires_at IS NOT NULL;
