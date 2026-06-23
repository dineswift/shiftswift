-- Employee self-service contact detail changes — HR approval workflow

CREATE TABLE IF NOT EXISTS employee_profile_change_requests (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  proposed_changes JSONB NOT NULL,
  previous_snapshot JSONB NOT NULL,
  employee_note TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_change_requests_tenant_status
  ON employee_profile_change_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_change_requests_employee
  ON employee_profile_change_requests (employee_id, created_at DESC);

COMMENT ON TABLE employee_profile_change_requests IS 'Employee-proposed contact detail updates pending HR approval.';
