-- Type-specific identity dates on employee documents:
-- issued_at  = passport issue date / visa start date
-- recorded_at = right-to-work date taken
-- expires_at  (existing) = passport expiry / visa end / RTW expiry

ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS issued_at DATE,
  ADD COLUMN IF NOT EXISTS recorded_at DATE;

ALTER TABLE tenant_documents
  ADD COLUMN IF NOT EXISTS issued_at DATE,
  ADD COLUMN IF NOT EXISTS recorded_at DATE;

CREATE INDEX IF NOT EXISTS idx_employee_documents_issued
  ON employee_documents (tenant_id, issued_at)
  WHERE issued_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_documents_recorded
  ON employee_documents (tenant_id, recorded_at)
  WHERE recorded_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_documents_issued
  ON tenant_documents (tenant_id, issued_at)
  WHERE issued_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_documents_recorded
  ON tenant_documents (tenant_id, recorded_at)
  WHERE recorded_at IS NOT NULL;
