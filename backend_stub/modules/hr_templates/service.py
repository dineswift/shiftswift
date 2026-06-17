"""HR process templates — platform defaults with per-tenant customisation."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from modules.hr_templates.sync import build_download_markdown, list_template_revisions
from modules.hr_templates.versioning import format_download_filename, version_lt


def _platform_row(cur: Any, template_id: str) -> tuple[Any, ...]:
    cur.execute(
        """
        SELECT id, category, title, description, content_markdown, version,
               legal_basis, change_summary, published_at, sort_order
        FROM hr_process_templates
        WHERE id = %s AND is_active = TRUE
        """,
        (template_id,),
    )
    row = cur.fetchone()
    if not row:
        raise LookupError("template not found")
    return row


def _enrich_list_item(row: tuple[Any, ...]) -> dict[str, Any]:
    (
        template_id,
        category,
        title,
        description,
        platform_version,
        sort_order,
        tenant_title,
        tenant_updated_at,
        tenant_updated_by,
        is_customised,
        based_on_version,
        legal_basis,
        change_summary,
        published_at,
    ) = row

    effective_based = based_on_version or (platform_version if not is_customised else "1.0")
    update_available = bool(
        is_customised and effective_based and version_lt(effective_based, platform_version)
    )
    sync_status = "current"
    if update_available:
        sync_status = "update_available"
    elif is_customised:
        sync_status = "custom"
    else:
        sync_status = "platform_latest"

    published_iso = published_at.isoformat() if isinstance(published_at, datetime) else published_at

    return {
        "id": template_id,
        "category": category,
        "title": title,
        "description": description,
        "platform_version": platform_version,
        "sort_order": sort_order,
        "tenant_title": tenant_title,
        "tenant_updated_at": tenant_updated_at.isoformat() if isinstance(tenant_updated_at, datetime) else tenant_updated_at,
        "tenant_updated_by": tenant_updated_by,
        "is_customised": bool(is_customised),
        "based_on_platform_version": based_on_version,
        "legal_basis": legal_basis,
        "change_summary": change_summary,
        "published_at": published_iso,
        "update_available": update_available,
        "sync_status": sync_status,
        "display_title": tenant_title or title,
        "display_version": platform_version if not is_customised else f"{effective_based} custom",
        "download_platform_filename": format_download_filename(
            template_id=template_id, version=platform_version, variant="platform-latest"
        ),
        "download_effective_filename": format_download_filename(
            template_id=template_id,
            version=platform_version if not is_customised else f"{effective_based}-custom",
            variant="effective",
        ),
    }


def list_templates_for_tenant(*, tenant_id: int, conn: Any) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.id, p.category, p.title, p.description, p.version, p.sort_order,
                   t.title, t.updated_at, t.updated_by,
                   (t.id IS NOT NULL) AS is_customised,
                   t.based_on_platform_version,
                   p.legal_basis, p.change_summary, p.published_at
            FROM hr_process_templates p
            LEFT JOIN tenant_hr_templates t
              ON t.template_id = p.id AND t.tenant_id = %s
            WHERE p.is_active = TRUE
            ORDER BY p.sort_order ASC, p.title ASC
            """,
            (tenant_id,),
        )
        rows = cur.fetchall()
    return [_enrich_list_item(row) for row in rows]


def get_updates_summary(*, tenant_id: int, conn: Any) -> dict[str, Any]:
    items = list_templates_for_tenant(tenant_id=tenant_id, conn=conn)
    pending = [item for item in items if item["update_available"]]
    return {
        "pending_count": len(pending),
        "platform_sync_note": "Templates without custom edits always use the latest platform version automatically.",
        "items": pending,
    }


def get_template_content(*, tenant_id: int, template_id: str, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        platform = _platform_row(cur, template_id)
        cur.execute(
            """
            SELECT title, content_markdown, based_on_platform_version, updated_at, updated_by
            FROM tenant_hr_templates
            WHERE tenant_id = %s AND template_id = %s
            """,
            (tenant_id, template_id),
        )
        tenant_row = cur.fetchone()

    (
        _pid,
        category,
        platform_title,
        description,
        platform_content,
        platform_version,
        legal_basis,
        change_summary,
        published_at,
        _sort,
    ) = platform

    customised = tenant_row is not None
    based_on = tenant_row[2] if tenant_row else None
    effective_based = based_on or ("1.0" if customised else platform_version)
    update_available = bool(customised and version_lt(effective_based, platform_version))

    published_iso = published_at.isoformat() if isinstance(published_at, datetime) else published_at

    return {
        "id": template_id,
        "category": category,
        "platform_title": platform_title,
        "description": description,
        "platform_content_markdown": platform_content,
        "platform_version": platform_version,
        "legal_basis": legal_basis,
        "change_summary": change_summary,
        "published_at": published_iso,
        "title": tenant_row[0] if tenant_row else platform_title,
        "content_markdown": tenant_row[1] if tenant_row else platform_content,
        "is_customised": customised,
        "based_on_platform_version": based_on,
        "update_available": update_available,
        "updated_at": tenant_row[3].isoformat() if tenant_row and isinstance(tenant_row[3], datetime) else None,
        "updated_by": tenant_row[4] if tenant_row else None,
        "revisions": list_template_revisions(template_id=template_id, conn=conn, limit=10),
        "download_recommendation": "platform" if not customised else ("platform" if update_available else "custom"),
    }


def save_tenant_template(
    *,
    tenant_id: int,
    template_id: str,
    title: str,
    content_markdown: str,
    updated_by: str,
    conn: Any,
) -> dict[str, Any]:
    with conn.cursor() as cur:
        platform = _platform_row(cur, template_id)
        platform_version = platform[5]
        cur.execute(
            """
            INSERT INTO tenant_hr_templates (
              tenant_id, template_id, title, content_markdown, version,
              based_on_platform_version, last_seen_platform_version, updated_by
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, template_id) DO UPDATE SET
              title = EXCLUDED.title,
              content_markdown = EXCLUDED.content_markdown,
              version = EXCLUDED.version,
              based_on_platform_version = EXCLUDED.based_on_platform_version,
              last_seen_platform_version = EXCLUDED.last_seen_platform_version,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW()
            RETURNING updated_at
            """,
            (
                tenant_id,
                template_id,
                title.strip(),
                content_markdown,
                platform_version,
                platform_version,
                platform_version,
                updated_by,
            ),
        )
        updated_at = cur.fetchone()[0]
    conn.commit()
    result = get_template_content(tenant_id=tenant_id, template_id=template_id, conn=conn)
    result["saved_at"] = updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at
    return result


def apply_platform_update(*, tenant_id: int, template_id: str, updated_by: str, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        platform = _platform_row(cur, template_id)
        (
            _pid,
            _cat,
            platform_title,
            _desc,
            platform_content,
            platform_version,
            _legal,
            _change,
            _pub,
            _sort,
        ) = platform
        cur.execute(
            """
            INSERT INTO tenant_hr_templates (
              tenant_id, template_id, title, content_markdown, version,
              based_on_platform_version, last_seen_platform_version, updated_by
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tenant_id, template_id) DO UPDATE SET
              title = EXCLUDED.title,
              content_markdown = EXCLUDED.content_markdown,
              version = EXCLUDED.version,
              based_on_platform_version = EXCLUDED.based_on_platform_version,
              last_seen_platform_version = EXCLUDED.last_seen_platform_version,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW()
            """,
            (
                tenant_id,
                template_id,
                platform_title,
                platform_content,
                platform_version,
                platform_version,
                platform_version,
                updated_by,
            ),
        )
    conn.commit()
    return get_template_content(tenant_id=tenant_id, template_id=template_id, conn=conn)


def reset_tenant_template(*, tenant_id: int, template_id: str, conn: Any) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM tenant_hr_templates WHERE tenant_id = %s AND template_id = %s RETURNING template_id",
            (tenant_id, template_id),
        )
        if not cur.fetchone():
            raise LookupError("no tenant customisation to reset")
    conn.commit()
    return get_template_content(tenant_id=tenant_id, template_id=template_id, conn=conn)


def build_template_download(
    *,
    tenant_id: int,
    template_id: str,
    variant: str,
    conn: Any,
    ext: str = "md",
) -> tuple[str, str]:
    """Return (filename, markdown body). variant: platform | effective"""
    template = get_template_content(tenant_id=tenant_id, template_id=template_id, conn=conn)
    platform_version = template["platform_version"]
    based_on = template["based_on_platform_version"] or "1.0"

    if variant == "platform" or (variant == "effective" and not template["is_customised"]):
        body = build_download_markdown(
            title=template["platform_title"],
            content_markdown=template["platform_content_markdown"],
            version=platform_version,
            variant="platform",
            legal_basis=template["legal_basis"],
            change_summary=template["change_summary"],
            published_at=template["published_at"],
        )
        filename = format_download_filename(
            template_id=template_id,
            version=platform_version,
            variant="platform-latest",
            ext=ext,
        )
        return filename, body

    body = build_download_markdown(
        title=template["title"],
        content_markdown=template["content_markdown"],
        version=f"{based_on}-custom",
        variant="custom",
        legal_basis=template["legal_basis"],
        change_summary=template["change_summary"],
        published_at=template["published_at"],
        platform_version=platform_version,
        based_on_version=based_on,
        update_available=template["update_available"],
    )
    filename = format_download_filename(
        template_id=template_id,
        version=f"{based_on}-custom",
        variant="custom",
        ext=ext,
    )
    return filename, body


def tenant_ai_document_addon_enabled(*, tenant_id: int, conn: Any) -> bool:
    from core.schema import column_expr

    col = column_expr(
        conn,
        table="tenants",
        column="ai_document_addon",
        alias=None,
        null_sql="FALSE AS ai_document_addon",
    )
    with conn.cursor() as cur:
        cur.execute(f"SELECT {col} FROM tenants WHERE id = %s", (tenant_id,))
        row = cur.fetchone()
    return bool(row and row[0])


def tenant_ai_enabled(*, tenant_id: int, conn: Any) -> bool:
    """AI is available only when the paid document add-on is enabled."""
    return tenant_ai_document_addon_enabled(tenant_id=tenant_id, conn=conn)


def set_tenant_ai_enabled(*, tenant_id: int, enabled: bool, conn: Any) -> bool:
    if enabled and not tenant_ai_document_addon_enabled(tenant_id=tenant_id, conn=conn):
        raise ValueError("AI document assistant add-on is not enabled on this subscription.")
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE tenants SET ai_assistant_enabled = %s WHERE id = %s RETURNING ai_assistant_enabled",
            (enabled, tenant_id),
        )
        row = cur.fetchone()
        if not row:
            raise LookupError("tenant not found")
    conn.commit()
    return bool(row[0])


def log_ai_usage(
    *,
    tenant_id: int,
    username: str,
    action: str,
    template_id: str | None,
    prompt_excerpt: str,
    provider: str,
    model: str,
    conn: Any,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ai_assistant_log (
              tenant_id, username, action, template_id, prompt_excerpt, provider, model
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (tenant_id, username, action, template_id, prompt_excerpt[:500], provider, model),
        )
    conn.commit()
