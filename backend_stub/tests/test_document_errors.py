from modules.documents.errors import document_service_error_message


def test_document_service_error_message_storage() -> None:
    assert "storage" in document_service_error_message(PermissionError("denied")).lower()


def test_document_service_error_message_schema() -> None:
    class UndefinedColumn(Exception):
        pass

    assert "migrations" in document_service_error_message(UndefinedColumn("col")).lower()


def test_document_service_error_message_check_violation() -> None:
    class CheckViolation(Exception):
        pass

    assert "database rule" in document_service_error_message(CheckViolation("bad category")).lower()


def test_document_service_error_message_aborted_transaction() -> None:
    class InternalError(Exception):
        pass

    msg = document_service_error_message(
        InternalError("current transaction is aborted, commands ignored until end of transaction block")
    )
    assert "notifications" in msg.lower() or "migrations" in msg.lower()


def test_document_service_error_message_generic() -> None:
    assert "failed" in document_service_error_message(RuntimeError("boom")).lower()
