-- E-signature requests for uploaded employee documents (acknowledgment + signed copy in document store).

CREATE TABLE IF NOT EXISTS employee_document_signing_requests (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  source_document_id BIGINT NOT NULL REFERENCES employee_documents(id) ON DELETE CASCADE,
  signed_document_id BIGINT REFERENCES employee_documents(id) ON DELETE SET NULL,
  reference_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'signed', 'cancelled', 'expired')),
  signing_token TEXT NOT NULL UNIQUE,
  signing_token_expires_at TIMESTAMPTZ NOT NULL,
  signature_name TEXT,
  signature_ip TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_at TIMESTAMPTZ,
  sent_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_signing_token
  ON employee_document_signing_requests (signing_token);

CREATE INDEX IF NOT EXISTS idx_doc_signing_source
  ON employee_document_signing_requests (source_document_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_signing_employee
  ON employee_document_signing_requests (tenant_id, employee_id, created_at DESC);

COMMENT ON TABLE employee_document_signing_requests IS
  'Tracks send-for-signature on uploaded employee files; signed acknowledgment stored as new employee_document.';
