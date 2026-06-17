-- Remove document rows left by failed uploads (no stored file and no external URL).

DELETE FROM employee_documents
WHERE COALESCE(NULLIF(TRIM(storage_path), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(document_url), ''), NULL) IS NULL;

DELETE FROM tenant_documents
WHERE COALESCE(NULLIF(TRIM(storage_path), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(document_url), ''), NULL) IS NULL;
