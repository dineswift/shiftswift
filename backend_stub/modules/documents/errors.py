"""User-facing document API error messages."""

from __future__ import annotations

import re

_SAFE_ERROR_HINT = re.compile(r"[^a-zA-Z0-9 ,.:;_\-/'()]+")


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


def _sanitize_error_hint(message: str, *, limit: int = 160) -> str:
    cleaned = _SAFE_ERROR_HINT.sub(" ", message).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:limit]


def _postgres_error_message(exc: Exception) -> str | None:
    try:
        import psycopg2
    except ImportError:
        return None

    if not isinstance(exc, psycopg2.Error):
        return None

    pgcode = getattr(exc, "pgcode", None)
    diag = getattr(exc, "diag", None)
    constraint = (getattr(diag, "constraint_name", None) or "").lower()
    message = str(exc).lower()

    if pgcode == "42703" or "undefined column" in message:
        return "Document upload is unavailable. Run database migrations and try again."
    if pgcode == "42P01" or "undefined table" in message:
        return "Document upload is unavailable. Run database migrations and try again."
    if pgcode == "23514" or "check constraint" in message:
        if "category" in constraint or "category" in message:
            return (
                "This document category is not allowed on the server yet. "
                "Run database migrations and try again."
            )
        if "lifecycle" in constraint or "lifecycle_stage" in message:
            return (
                "This document type is not allowed on the server yet. "
                "Run database migrations and try again."
            )
        return (
            "This document could not be saved because of a database rule mismatch. "
            "Run database migrations and try again."
        )
    if pgcode == "23502":
        return "A required document field is missing in the database. Run database migrations and try again."
    if pgcode == "23503":
        return "The selected employee or business record could not be linked to this document."
    if pgcode == "25P02" or "current transaction is aborted" in message:
        return (
            "Document was saved but follow-up notifications failed. "
            "Try again; if it keeps happening, run database migrations."
        )
    return None


def document_service_error_message(exc: Exception) -> str:
    if isinstance(exc, LookupError):
        return (
            "The document record could not be loaded after upload. "
            "Run database migrations and try again."
        )
    if isinstance(exc, (OSError, PermissionError)):
        return (
            "Document storage is not writable on the server. "
            "Check DOCUMENTS_STORAGE_DIR permissions and try again."
        )

    for candidate in (exc, getattr(exc, "__cause__", None), getattr(exc, "__context__", None)):
        if isinstance(candidate, Exception):
            postgres_message = _postgres_error_message(candidate)
            if postgres_message:
                return postgres_message

    msg = str(exc).lower()
    exc_name = type(exc).__name__
    if exc_name in {"UndefinedColumn", "UndefinedTable"}:
        return "Document upload is unavailable. Run database migrations and try again."
    if exc_name == "ProgrammingError" and (
        "column" in msg or "relation" in msg or "does not exist" in msg
    ):
        return "Document upload is unavailable. Run database migrations and try again."
    if exc_name in {"CheckViolation", "IntegrityError", "NotNullViolation", "ForeignKeyViolation"} or (
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

    hint = _sanitize_error_hint(str(exc))
    if hint:
        return f"Document upload failed: {hint}"
    return "Document upload failed. Try again or contact support."
