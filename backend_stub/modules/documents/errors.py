"""User-facing document API error messages."""

from __future__ import annotations


def document_service_error_message(exc: Exception) -> str:
    if isinstance(exc, (OSError, PermissionError)):
        return (
            "Document storage is not writable on the server. "
            "Check DOCUMENTS_STORAGE_DIR permissions and try again."
        )
    msg = str(exc).lower()
    exc_name = type(exc).__name__
    if exc_name in {"UndefinedColumn", "UndefinedTable"}:
        return "Document upload is unavailable. Run database migrations and try again."
    if exc_name == "ProgrammingError" and (
        "column" in msg or "relation" in msg or "does not exist" in msg
    ):
        return "Document upload is unavailable. Run database migrations and try again."
    if "missing required columns" in msg:
        return "Document upload is unavailable. Run database migrations and try again."
    return "Document upload failed. Try again or contact support."
