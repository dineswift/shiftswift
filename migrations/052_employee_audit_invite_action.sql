-- Allow portal invite and document/disciplinary audit events in employee_data_audit_log

ALTER TABLE employee_data_audit_log DROP CONSTRAINT IF EXISTS employee_data_audit_log_action_check;

UPDATE employee_data_audit_log
SET action = 'update'
WHERE action IS NULL
   OR btrim(action) = ''
   OR lower(btrim(action)) NOT IN (
     'view', 'create', 'update', 'delete', 'export', 'invite',
     'upload', 'distribute', 'close', 'draft_document'
   );

ALTER TABLE employee_data_audit_log ADD CONSTRAINT employee_data_audit_log_action_check
  CHECK (action IN (
    'view', 'create', 'update', 'delete', 'export', 'invite',
    'upload', 'distribute', 'close', 'draft_document'
  ));

COMMENT ON COLUMN employee_data_audit_log.action IS 'Includes invite, upload, distribute, close, and draft_document audit events.';
