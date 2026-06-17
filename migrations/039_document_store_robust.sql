-- Robust document store: lifecycle tagging, expiry, employee links, metadata

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'induction',
  ADD COLUMN IF NOT EXISTS expires_at DATE,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_lifecycle_stage_check;

UPDATE employee_documents
SET lifecycle_stage = 'document_store'
WHERE lifecycle_stage IS NULL
   OR btrim(lifecycle_stage) = ''
   OR lifecycle_stage NOT IN (
     'recruitment', 'onboarding', 'induction', 'document_store', 'compliance',
     'offboarding', 'general', 'active'
   );

ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_lifecycle_stage_check
  CHECK (lifecycle_stage IN ('recruitment', 'onboarding', 'induction', 'document_store', 'compliance', 'offboarding', 'general', 'active'));

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_category_check;
ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_category_check
  CHECK (category IN ('general', 'contract', 'id', 'rtw', 'qualification', 'disciplinary', 'policy', 'other'));

CREATE INDEX IF NOT EXISTS idx_employee_documents_category
  ON employee_documents (tenant_id, employee_id, category);

CREATE INDEX IF NOT EXISTS idx_employee_documents_stage
  ON employee_documents (tenant_id, employee_id, lifecycle_stage);

ALTER TABLE tenant_documents
  ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS expires_at DATE,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE tenant_documents DROP CONSTRAINT IF EXISTS tenant_documents_lifecycle_stage_check;

UPDATE tenant_documents
SET lifecycle_stage = 'general'
WHERE lifecycle_stage IS NULL
   OR btrim(lifecycle_stage) = ''
   OR lifecycle_stage NOT IN (
     'recruitment', 'onboarding', 'induction', 'document_store', 'compliance',
     'offboarding', 'general', 'policy', 'active'
   );

ALTER TABLE tenant_documents ADD CONSTRAINT tenant_documents_lifecycle_stage_check
  CHECK (lifecycle_stage IN ('recruitment', 'onboarding', 'induction', 'document_store', 'compliance', 'offboarding', 'general', 'policy', 'active'));

CREATE INDEX IF NOT EXISTS idx_tenant_documents_category
  ON tenant_documents (tenant_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_documents_employee
  ON tenant_documents (tenant_id, employee_id)
  WHERE employee_id IS NOT NULL;
