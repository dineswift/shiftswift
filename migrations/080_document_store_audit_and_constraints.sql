-- Document store: audit actions for uploads/distribution and constraint repair on partial migrations.

ALTER TABLE employee_data_audit_log DROP CONSTRAINT IF EXISTS employee_data_audit_log_action_check;
ALTER TABLE employee_data_audit_log ADD CONSTRAINT employee_data_audit_log_action_check
  CHECK (action IN (
    'view', 'create', 'update', 'delete', 'export', 'invite',
    'upload', 'distribute', 'close', 'draft_document'
  ));

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_category_check;
ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_category_check
  CHECK (category IN (
    'general', 'contract', 'id', 'rtw', 'qualification', 'disciplinary', 'policy',
    'other', 'payslip', 'visa_brp', 'dbs', 'training'
  ));

ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_lifecycle_stage_check;
ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_lifecycle_stage_check
  CHECK (lifecycle_stage IN (
    'recruitment', 'onboarding', 'induction', 'document_store', 'compliance',
    'offboarding', 'general', 'active'
  ));
