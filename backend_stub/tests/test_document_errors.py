from modules.documents.errors import document_service_error_message


def test_document_service_error_message_storage() -> None:
    assert "storage" in document_service_error_message(PermissionError("denied")).lower()


def test_document_service_error_message_schema() -> None:
    class UndefinedColumn(Exception):
        pass

    assert "migrations" in document_service_error_message(UndefinedColumn("col")).lower()


def test_document_service_error_message_check_violation() -> None:
    class CheckViolation(Exception):
        pgcode = "23514"

        def __init__(self) -> None:
            super().__init__("check constraint employee_documents_category_check")

    msg = document_service_error_message(CheckViolation())
    assert "category" in msg.lower() or "database rule" in msg.lower()


def test_document_service_error_message_aborted_transaction() -> None:
    class InternalError(Exception):
        pgcode = "25P02"

        def __init__(self) -> None:
            super().__init__("current transaction is aborted, commands ignored until end of transaction block")

    msg = document_service_error_message(InternalError())
    assert "notifications" in msg.lower() or "migrations" in msg.lower()


def test_document_service_error_message_includes_hint() -> None:
    msg = document_service_error_message(RuntimeError("disk quota exceeded on tenant volume"))
    assert "disk quota exceeded" in msg.lower()


def test_document_service_error_message_generic() -> None:
    assert "failed" in document_service_error_message(Exception()).lower()
