-- Repair document store schema when migration 039 stopped before tenant_documents / 072 columns.
-- Safe to re-run: columns only, no new check constraints.

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'induction',
  ADD COLUMN IF NOT EXISTS expires_at DATE,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS pay_period TEXT,
  ADD COLUMN IF NOT EXISTS expiry_alert_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS employee_visible BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE tenant_documents
  ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS expires_at DATE,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS expiry_alert_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS employee_visible BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE employee_documents
SET category = lower(btrim(category))
WHERE category IS NOT NULL
  AND category <> lower(btrim(category));

UPDATE employee_documents
SET category = 'other'
WHERE category IS NULL
   OR btrim(category) = ''
   OR lower(btrim(category)) NOT IN (
     'general', 'contract', 'id', 'rtw', 'qualification', 'disciplinary', 'policy', 'other',
     'payslip', 'visa_brp', 'dbs', 'training'
   );

CREATE INDEX IF NOT EXISTS idx_tenant_documents_expires
  ON tenant_documents (tenant_id, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_documents_expires
  ON employee_documents (tenant_id, expires_at)
  WHERE expires_at IS NOT NULL;
