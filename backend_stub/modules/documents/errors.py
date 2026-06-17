"""User-facing document API error messages."""

from __future__ import annotations


def _rollback_quietly(conn: object | None) -> None:
    if conn is None:
        return
    rollback = getattr(conn, "rollback", None)
    if not callable(rollback):
        return
    try:
        rollback()
    except Exception:
        pass


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
    if exc_name in {"CheckViolation", "IntegrityError"} or (
        exc_name == "InternalError" and "check constraint" in msg
    ):
        return (
            "This document could not be saved because of a database rule mismatch. "
            "Run database migrations and try again."
        )
    if exc_name in {"InFailedSqlTransaction", "InternalError"} and (
        "current transaction is aborted" in msg or "commands ignored until end of transaction block" in msg
    ):
        return (
            "Document was saved but follow-up notifications failed. "
            "Try again; if it keeps happening, run database migrations."
        )
    if "missing required columns" in msg:
        return "Document upload is unavailable. Run database migrations and try again."
    if "document insert succeeded but could not be loaded" in msg:
        return "Document upload is unavailable. Run database migrations and try again."
    return "Document upload failed. Try again or contact support."
