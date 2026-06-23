"""List and build platform global document downloads."""

from __future__ import annotations

from typing import Any

from modules.global_documents.catalog import GLOBAL_DOCUMENTS, GLOBAL_DOCUMENT_CATEGORIES


def _public_entry(entry: dict[str, Any]) -> dict[str, Any]:
    file_format = str(entry.get("file_format") or "docx")
    excel_compatible = file_format in {"csv", "xlsx"}
    return {
        "id": entry["id"],
        "title": entry["title"],
        "description": entry.get("description") or "",
        "category": entry.get("category") or "forms",
        "category_label": GLOBAL_DOCUMENT_CATEGORIES.get(
            str(entry.get("category") or "forms"),
            "Forms",
        ),
        "file_format": file_format,
        "format_label": "Excel (.csv)" if file_format == "csv" else file_format.upper(),
        "filename": entry.get("filename") or f"{entry['id']}.{file_format}",
        "excel_compatible": excel_compatible,
        "sort_order": int(entry.get("sort_order") or 0),
    }


def list_global_documents(*, category: str | None = None) -> list[dict[str, Any]]:
    items = [_public_entry(entry) for entry in GLOBAL_DOCUMENTS if entry.get("is_active", True)]
    if category:
        items = [item for item in items if item["category"] == category]
    items.sort(key=lambda row: (row["sort_order"], row["title"].lower()))
    return items


def get_global_document(doc_id: str) -> dict[str, Any]:
    for entry in GLOBAL_DOCUMENTS:
        if entry.get("id") == doc_id and entry.get("is_active", True):
            return entry
    raise LookupError("document not found")


def build_global_document_download(doc_id: str) -> tuple[str, bytes, str]:
    entry = get_global_document(doc_id)
    filename = str(entry.get("filename") or f"{doc_id}.bin")
    file_format = str(entry.get("file_format") or "docx").lower()

    if file_format == "csv":
        body = str(entry.get("csv_content") or "").encode("utf-8")
        return filename, body, "text/csv; charset=utf-8"

    if file_format in {"docx", "doc"}:
        from modules.hr_templates.export_document import build_template_word_bytes

        markdown = str(entry.get("markdown") or "")
        if not markdown.strip():
            raise LookupError("document has no content")
        title = str(entry.get("title") or doc_id)
        return (
            filename,
            build_template_word_bytes(markdown, title=title),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    raise LookupError(f"unsupported format: {file_format}")
