from modules.documents.errors import document_service_error_message


def test_document_service_error_message_storage() -> None:
    assert "storage" in document_service_error_message(PermissionError("denied")).lower()


def test_document_service_error_message_schema() -> None:
    class UndefinedColumn(Exception):
        pass

    assert "migrations" in document_service_error_message(UndefinedColumn("col")).lower()


def test_document_service_error_message_generic() -> None:
    assert "failed" in document_service_error_message(RuntimeError("boom")).lower()
