-- Right to work check expiry on the employee sponsor profile (separate from visa / BRP).

ALTER TABLE employee_sponsor_profiles
  ADD COLUMN IF NOT EXISTS rtw_check_expiry_date DATE;

CREATE INDEX IF NOT EXISTS idx_employee_sponsor_rtw_check_expiry
  ON employee_sponsor_profiles (tenant_id, rtw_check_expiry_date)
  WHERE rtw_check_expiry_date IS NOT NULL;
