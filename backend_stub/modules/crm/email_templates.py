"""CRM email templates — seed defaults, render placeholders."""

from __future__ import annotations

from typing import Any

from modules.crm.constants import DEFAULT_EMAIL_TEMPLATES


def _row_to_template(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "template_key": row[1],
        "name": row[2],
        "subject": row[3],
        "body_html": row[4],
        "body_text": row[5],
        "is_system": bool(row[6]),
    }


def ensure_default_templates(*, tenant_id: int, conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT template_key FROM crm_email_templates WHERE tenant_id = %s",
            (tenant_id,),
        )
        existing = {row[0] for row in cur.fetchall()}
    for template in DEFAULT_EMAIL_TEMPLATES:
        if template["template_key"] in existing:
            continue
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO crm_email_templates (
                  tenant_id, template_key, name, subject, body_html, body_text, is_system
                ) VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                """,
                (
                    tenant_id,
                    template["template_key"],
                    template["name"],
                    template["subject"],
                    template["body_html"],
                    template.get("body_text"),
                ),
            )


def list_templates(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    ensure_default_templates(tenant_id=tenant_id, conn=conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, template_key, name, subject, body_html, body_text, is_system
            FROM crm_email_templates
            WHERE tenant_id = %s
            ORDER BY name
            """,
            (tenant_id,),
        )
        return [_row_to_template(row) for row in cur.fetchall()]


def fetch_template(
    *,
    tenant_id: int,
    template_key: str,
    conn: Any,
) -> dict[str, Any] | None:
    ensure_default_templates(tenant_id=tenant_id, conn=conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, template_key, name, subject, body_html, body_text, is_system
            FROM crm_email_templates
            WHERE tenant_id = %s AND template_key = %s
            """,
            (tenant_id, template_key),
        )
        row = cur.fetchone()
        return _row_to_template(row) if row else None


def render_template_text(text: str, context: dict[str, str]) -> str:
    rendered = text
    for key, value in context.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", value or "")
    return rendered


def render_template(
    template: dict[str, Any],
    *,
    context: dict[str, str],
) -> dict[str, str]:
    subject = render_template_text(str(template["subject"]), context)
    body_html = render_template_text(str(template["body_html"]), context)
    body_text_raw = template.get("body_text") or template["body_html"]
    body_text = render_template_text(str(body_text_raw), context)
    return {"subject": subject, "body_html": body_html, "body_text": body_text}
