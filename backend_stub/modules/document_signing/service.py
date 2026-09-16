"""Send uploaded employee documents for e-signature; store signed acknowledgment on file."""

from __future__ import annotations

import html
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from modules.documents.service import create_employee_document, get_employee_document, update_employee_document

UNSIGNABLE_CATEGORIES = frozenset({"payslip"})


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _reference_code(request_id: int) -> str:
    return f"DOC-SIG-{request_id:06d}"


def _cancel_pending_for_document(*, conn: Any, source_document_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE employee_document_signing_requests
            SET status = 'cancelled'
            WHERE source_document_id = %s AND status = 'sent'
            """,
            (source_document_id,),
        )


def _employee_contact(*, conn: Any, tenant_id: int, employee_id: int) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT first_name, last_name, email
            FROM employees
            WHERE tenant_id = %s AND id = %s
            """,
            (tenant_id, employee_id),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Employee not found")
    first, last, email = row
    name = f"{first or ''} {last or ''}".strip() or "Employee"
    if not email or not str(email).strip():
        raise ValueError("Employee has no email address — add one on their profile first")
    return {"name": name, "email": str(email).strip()}


def signing_status_map(
    *,
    tenant_id: int,
    document_ids: list[int],
    conn: Any,
) -> dict[int, dict[str, Any]]:
    if not document_ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (source_document_id)
              source_document_id, status, reference_code, signed_at, signed_document_id, sent_at
            FROM employee_document_signing_requests
            WHERE tenant_id = %s AND source_document_id = ANY(%s)
            ORDER BY source_document_id, created_at DESC
            """,
            (tenant_id, document_ids),
        )
        rows = cur.fetchall()
    return {
        int(row[0]): {
            "signing_status": row[1],
            "signing_reference": row[2],
            "signed_at": row[3].isoformat() if row[3] else None,
            "signed_document_id": row[4],
            "sent_at": row[5].isoformat() if row[5] else None,
        }
        for row in rows
    }


def attach_signing_status(
    *,
    tenant_id: int,
    documents: list[dict[str, Any]],
    conn: Any,
) -> list[dict[str, Any]]:
    ids = [int(doc["id"]) for doc in documents if doc.get("id") is not None]
    status_by_id = signing_status_map(tenant_id=tenant_id, document_ids=ids, conn=conn)
    enriched: list[dict[str, Any]] = []
    for doc in documents:
        item = dict(doc)
        meta = status_by_id.get(int(doc["id"])) if doc.get("id") is not None else None
        if meta:
            item.update(meta)
        else:
            item.setdefault("signing_status", None)
        enriched.append(item)
    return enriched


def send_document_for_signature(
    *,
    conn: Any,
    tenant_id: int,
    employee_id: int,
    document_id: int,
    actor: str | None,
    frontend_base: str,
) -> dict[str, Any]:
    doc = get_employee_document(
        tenant_id=tenant_id, employee_id=employee_id, document_id=document_id, conn=conn
    )
    if not doc:
        raise LookupError("Document not found")
    if not doc.get("storage_path"):
        raise ValueError("Upload a file before sending for signature — link-only records cannot be signed in-app")
    if doc.get("category") in UNSIGNABLE_CATEGORIES:
        raise ValueError("Payslips cannot be sent for e-signature — use Employment contracts for contract signing")

    contact = _employee_contact(conn=conn, tenant_id=tenant_id, employee_id=employee_id)
    token = secrets.token_urlsafe(32)
    expires = _utcnow() + timedelta(days=30)
    _cancel_pending_for_document(conn=conn, source_document_id=document_id)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO employee_document_signing_requests (
              tenant_id, employee_id, source_document_id, reference_code, status,
              signing_token, signing_token_expires_at, sent_by
            ) VALUES (%s, %s, %s, 'pending', 'sent', %s, %s, %s)
            RETURNING id
            """,
            (tenant_id, employee_id, document_id, token, expires, actor),
        )
        request_id = int(cur.fetchone()[0])
        reference = _reference_code(request_id)
        cur.execute(
            """
            UPDATE employee_document_signing_requests
            SET reference_code = %s
            WHERE id = %s
            """,
            (reference, request_id),
        )

    signing_url = f"{frontend_base.rstrip('/')}/sign-contract.html?token={token}&type=document"
    from core.email_templates import document_signing_email
    from core.notifications import require_email_delivered, send_email_content, smtp_configured

    if not smtp_configured():
        raise RuntimeError("SMTP is not configured on the server — set SMTP_* in environment")

    content = document_signing_email(
        signatory_name=contact["name"],
        document_title=str(doc.get("title") or "Document"),
        reference_code=reference,
        signing_url=signing_url,
    )
    delivery = send_email_content(
        conn=conn,
        tenant_id=tenant_id,
        content=content,
        purpose="document_signing",
        to=contact["email"],
        audience="employee",
        payload={
            "document_id": document_id,
            "signing_request_id": request_id,
            "signing_url": signing_url,
            "type": "document_signing",
            "employee_id": employee_id,
            "html_body": content.html,
        },
        deliver_now=True,
        commit=False,
    )
    require_email_delivered(delivery)
    conn.commit()
    return {
        "signing_request_id": request_id,
        "reference_code": reference,
        "status": "sent",
        "signatory_email": contact["email"],
        "signing_url": signing_url,
        "expires_at": expires.isoformat(),
        "email_sent": True,
    }


def resend_document_signing_email(
    *,
    conn: Any,
    tenant_id: int,
    employee_id: int,
    document_id: int,
    frontend_base: str,
) -> dict[str, Any]:
    """Resend the signing email for the latest active signing request."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, signing_token, signing_token_expires_at, reference_code, status
            FROM employee_document_signing_requests
            WHERE tenant_id = %s
              AND employee_id = %s
              AND source_document_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (tenant_id, employee_id, document_id),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("No signing request found for this document")
    request_id, token, expires, reference, status = row
    if status != "sent":
        raise ValueError("Signing request is not waiting for signature")
    if expires and expires < _utcnow():
        raise ValueError("Signing link has expired — send for signature again")

    doc = get_employee_document(
        tenant_id=tenant_id, employee_id=employee_id, document_id=document_id, conn=conn
    )
    if not doc:
        raise LookupError("Document not found")
    contact = _employee_contact(conn=conn, tenant_id=tenant_id, employee_id=employee_id)
    signing_url = f"{frontend_base.rstrip('/')}/sign-contract.html?token={token}&type=document"

    from core.email_templates import document_signing_email
    from core.notifications import require_email_delivered, send_email_content, smtp_configured

    if not smtp_configured():
        raise RuntimeError("SMTP is not configured on the server — set SMTP_* in environment")

    content = document_signing_email(
        signatory_name=contact["name"],
        document_title=str(doc.get("title") or "Document"),
        reference_code=str(reference),
        signing_url=signing_url,
    )
    delivery = send_email_content(
        conn=conn,
        tenant_id=tenant_id,
        content=content,
        purpose="document_signing",
        to=contact["email"],
        audience="employee",
        payload={
            "document_id": document_id,
            "signing_request_id": request_id,
            "signing_url": signing_url,
            "type": "document_signing",
            "employee_id": employee_id,
            "html_body": content.html,
        },
        deliver_now=True,
        commit=False,
    )
    require_email_delivered(delivery)
    conn.commit()
    return {
        "signing_request_id": request_id,
        "reference_code": reference,
        "signatory_email": contact["email"],
        "signing_url": signing_url,
        "email_sent": True,
        "message": f"Signing email resent to {contact['email']}",
    }


def get_signing_by_token(conn: Any, token: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id, r.tenant_id, r.employee_id, r.source_document_id, r.reference_code,
                   r.status, r.signing_token_expires_at, r.signed_at,
                   d.title, d.category, d.original_filename, d.content_type, d.content_sha256,
                   e.first_name, e.last_name, e.email
            FROM employee_document_signing_requests r
            JOIN employee_documents d
              ON d.id = r.source_document_id AND d.tenant_id = r.tenant_id
            JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
            WHERE r.signing_token = %s
            """,
            (token,),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Invalid signing link")
    expires = row[6]
    if expires and expires < _utcnow():
        raise ValueError("Signing link expired")
    if row[5] == "signed" or row[7]:
        raise ValueError("Document already signed")
    if row[5] != "sent":
        raise ValueError("Signing request is no longer active")
    name = f"{row[13] or ''} {row[14] or ''}".strip() or "Employee"
    content_type = (row[11] or "").lower()
    preview_mode = "download"
    if "pdf" in content_type:
        preview_mode = "pdf"
    elif content_type.startswith("image/"):
        preview_mode = "image"
    return {
        "signing_request_id": row[0],
        "reference_code": row[4],
        "title": row[8],
        "category": row[9],
        "original_filename": row[10],
        "content_sha256": row[12],
        "signatory_name": name,
        "signatory_email": row[15],
        "contract_type": "document",
        "preview_mode": preview_mode,
        "file_url": f"/document-sign/file/{token}",
    }


def resolve_signing_file(conn: Any, token: str) -> tuple[dict[str, Any], Any]:
    """Return document metadata and filesystem path for token-gated download."""
    from modules.documents.storage import resolve_stored_file

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.tenant_id, r.employee_id, r.source_document_id, r.status,
                   r.signing_token_expires_at, r.signed_at,
                   d.storage_path, d.content_type, d.title, d.original_filename
            FROM employee_document_signing_requests r
            JOIN employee_documents d ON d.id = r.source_document_id
            WHERE r.signing_token = %s
            """,
            (token,),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Invalid signing link")
    expires = row[4]
    if expires and expires < _utcnow():
        raise ValueError("Signing link expired")
    if row[3] not in ("sent", "signed"):
        raise ValueError("Signing request is not available")
    if row[5] and row[3] == "signed":
        pass
    path = resolve_stored_file(tenant_id=row[0], storage_path=row[6])
    meta = {
        "content_type": row[7] or "application/octet-stream",
        "title": row[8],
        "original_filename": row[9],
    }
    return meta, path


def _build_acknowledgment_html(
    *,
    doc: dict[str, Any],
    signature_name: str,
    reference_code: str,
    ip_address: str | None,
) -> str:
    signed_at = _utcnow().strftime("%d %B %Y %H:%M UTC")
    title = html.escape(str(doc.get("title") or "Document"))
    filename = html.escape(str(doc.get("original_filename") or "Uploaded file"))
    sha = html.escape(str(doc.get("content_sha256") or "Not recorded"))
    signer = html.escape(signature_name)
    ip = html.escape(ip_address or "Not recorded")
    ref = html.escape(reference_code)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Signed acknowledgment — {title}</title></head>
<body style="font-family:system-ui,sans-serif;line-height:1.5;max-width:720px;margin:2rem auto;padding:0 1rem;">
  <h1>Electronic signature acknowledgment</h1>
  <p><strong>Reference:</strong> {ref}</p>
  <p><strong>Document:</strong> {title}</p>
  <p><strong>Original file:</strong> {filename}</p>
  <p><strong>Content hash (SHA-256):</strong> {sha}</p>
  <section style="margin-top:2rem;padding:1rem;border:2px solid #0F6E56;">
    <h2>Signature</h2>
    <p><strong>Signed by:</strong> {signer}</p>
    <p><strong>Signed at:</strong> {signed_at}</p>
    <p><strong>IP address:</strong> {ip}</p>
    <p>The signatory confirms they reviewed the document identified above.</p>
  </section>
</body></html>"""


def sign_document(
    *,
    conn: Any,
    token: str,
    signature_name: str,
    ip_address: str | None,
) -> dict[str, Any]:
    get_signing_by_token(conn, token)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT tenant_id, employee_id, source_document_id, reference_code
            FROM employee_document_signing_requests
            WHERE signing_token = %s
            """,
            (token,),
        )
        row = cur.fetchone()
    if not row:
        raise LookupError("Invalid signing link")
    tenant_id, employee_id, source_document_id, reference_code = row

    source = get_employee_document(
        tenant_id=tenant_id,
        employee_id=employee_id,
        document_id=source_document_id,
        conn=conn,
    )
    if not source:
        raise LookupError("Document not found")

    signed_html = _build_acknowledgment_html(
        doc=source,
        signature_name=signature_name,
        reference_code=reference_code,
        ip_address=ip_address,
    )
    signed_bytes = signed_html.encode("utf-8")
    from modules.documents.storage import write_document_file

    signed_doc = create_employee_document(
        tenant_id=tenant_id,
        employee_id=employee_id,
        data={
            "title": f"Signed — {source.get('title')}",
            "category": source.get("category") or "general",
            "lifecycle_stage": source.get("lifecycle_stage") or "document_store",
            "notes": f"E-signature acknowledgment for document #{source_document_id} ({reference_code}).",
            "original_filename": f"{reference_code}-signed.html",
            "employee_visible": source.get("employee_visible", True),
        },
        uploaded_by="employee_signature",
        conn=conn,
    )
    storage_path, content_sha256, file_size = write_document_file(
        tenant_id=tenant_id,
        document_id=int(signed_doc["id"]),
        title=f"Signed — {source.get('title')}",
        original_filename=f"{reference_code}-signed.html",
        data=signed_bytes,
        content_type="text/html; charset=utf-8",
        ext=".html",
        scope="employee",
        employee_id=employee_id,
    )
    update_employee_document(
        tenant_id=tenant_id,
        employee_id=employee_id,
        document_id=int(signed_doc["id"]),
        updates={
            "storage_path": storage_path,
            "content_sha256": content_sha256,
            "content_type": "text/html; charset=utf-8",
            "file_size_bytes": file_size,
            "original_filename": f"{reference_code}-signed.html",
        },
        conn=conn,
    )

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE employee_document_signing_requests
            SET status = 'signed', signed_at = NOW(), signature_name = %s, signature_ip = %s,
                signed_document_id = %s
            WHERE signing_token = %s
            RETURNING id
            """,
            (signature_name, ip_address, signed_doc["id"], token),
        )
        if not cur.fetchone():
            raise LookupError("Signing request not found")
    conn.commit()
    return {
        "reference_code": reference_code,
        "status": "signed",
        "signed_document_id": signed_doc["id"],
        "source_document_id": source_document_id,
    }
