"""Platform master admin API — tenant register, ops, settings, audit."""

from __future__ import annotations

import os
from typing import Annotated, Any

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Body
from pydantic import BaseModel, Field

from auth_service import AuthUser
from config import load_settings
from deps import client_ip, get_master_user
from modules.master.audit import write_master_audit
from modules.master.platform_ops import (
    change_master_password,
    cleanup_duplicate_tenants,
    disable_master_mfa,
    email_tenant_contact,
    extend_trial,
    master_account_profile,
    restore_tenant,
    save_internal_notes,
    soft_delete_tenant,
    suspend_tenant,
    unsuspend_tenant,
)
from modules.master.tenant_provision import (
    create_tenant_manually,
    generate_temporary_password,
    list_provision_plans,
    update_tenant_billing,
)
from modules.master.platform_settings import (
    api_keys_snapshot,
    list_email_log,
    list_master_audit_log,
    platform_settings_snapshot,
)
from modules.master.service import FilterStatus, get_tenant_detail, list_tenants, overview_stats

router = APIRouter(prefix="/master", tags=["Platform Master"])
settings = load_settings()
logger = logging.getLogger(__name__)


def _db_conn() -> Any:
    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


def _audit(
    *,
    request: Request,
    current_user: AuthUser,
    action: str,
    conn: Any,
    target_tenant_id: int | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    write_master_audit(
        settings,
        master_username=current_user.username,
        action=action,
        target_tenant_id=target_tenant_id,
        ip_address=client_ip(request),
        user_agent=request.headers.get("User-Agent"),
        detail=detail,
        conn=conn,
    )


class SuspendRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class DeleteTenantRequest(BaseModel):
    confirm_name: str = Field(min_length=1, max_length=200)


class ExtendTrialRequest(BaseModel):
    days: int = Field(default=14, ge=1, le=90)


class InternalNotesRequest(BaseModel):
    notes: str = Field(default="", max_length=8000)


class EmailTenantRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=8000)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


class DisableMfaRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)


class CleanupDuplicatesRequest(BaseModel):
    confirm: bool = False


class CreateTenantRequest(BaseModel):
    business_name: str = Field(min_length=2, max_length=200)
    billing_email: str = Field(min_length=3, max_length=254)
    admin_password: str = Field(min_length=8, max_length=256)
    plan_id: str = Field(default="site_medium_monthly", max_length=64)
    billing_mode: str = Field(default="offline", pattern="^(offline|stripe)$")
    access: str = Field(default="active", pattern="^(active|trialing)$")
    trial_days: int = Field(default=14, ge=1, le=90)
    max_employees: int | None = Field(default=None, ge=1, le=9999)
    billing_notes: str | None = Field(default=None, max_length=2000)
    send_welcome_email: bool = True


class UpdateTenantBillingRequest(BaseModel):
    billing_mode: str = Field(pattern="^(offline|stripe)$")
    subscription_status: str | None = Field(default=None, pattern="^(active|trialing)$")
    plan_id: str | None = Field(default=None, max_length=64)
    max_employees: int | None = Field(default=None, ge=1, le=9999)
    trial_days: int | None = Field(default=None, ge=1, le=90)
    billing_notes: str | None = Field(default=None, max_length=2000)
    rota_advanced_addon: bool | None = None
    rota_multi_site_addon: bool | None = None
    crm_addon: bool | None = None


@router.get("/overview")
def master_overview(
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        stats = overview_stats(conn=conn, master_tenant_id=int(settings.master_customer_id))
        _audit(request=request, current_user=current_user, action="VIEW_OVERVIEW", conn=conn)
        conn.commit()
        return {
            "provider_name": os.getenv("PROVIDER_LEGAL_NAME", "Datasoftware Analytics Ltd"),
            "stats": stats,
            "billing": api_keys_snapshot()["stripe"],
        }
    finally:
        conn.close()


@router.get("/tenants")
def master_tenant_list(
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
    status: FilterStatus = Query(default="all"),
    q: str | None = Query(default=None, max_length=120),
    include_deleted: bool = Query(default=False),
    exclude_test: bool = Query(default=False),
) -> dict[str, object]:
    conn = _db_conn()
    try:
        tenants = list_tenants(
            conn=conn,
            master_tenant_id=int(settings.master_customer_id),
            status_filter=status,
            search=q,
            include_deleted=include_deleted,
            exclude_test=exclude_test,
        )
        stats = overview_stats(
            conn=conn,
            master_tenant_id=int(settings.master_customer_id),
            include_deleted=include_deleted,
            exclude_test=exclude_test,
        )
        _audit(
            request=request,
            current_user=current_user,
            action="LIST_TENANTS",
            conn=conn,
            detail={"status": status, "q": q, "count": len(tenants), "include_deleted": include_deleted},
        )
        conn.commit()
        return {
            "tenants": tenants,
            "stats": stats["counts"],
            "overview": stats,
            "provider_name": os.getenv("PROVIDER_LEGAL_NAME", "Datasoftware Analytics Ltd"),
        }
    finally:
        conn.close()


@router.get("/plans")
def master_provision_plans(
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    return {"plans": list_provision_plans()}


@router.get("/tenants/generate-password")
def master_generate_password(
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, str]:
    return {"password": generate_temporary_password()}


@router.post("/tenants/create")
def master_create_tenant(
    payload: CreateTenantRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = create_tenant_manually(
                conn=conn,
                master_tenant_id=int(settings.master_customer_id),
                business_name=payload.business_name,
                billing_email=payload.billing_email,
                admin_password=payload.admin_password,
                plan_id=payload.plan_id,
                billing_mode=payload.billing_mode,  # type: ignore[arg-type]
                access=payload.access,  # type: ignore[arg-type]
                trial_days=payload.trial_days,
                max_employees=payload.max_employees,
                billing_notes=payload.billing_notes,
                send_welcome_email=payload.send_welcome_email,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(
            request=request,
            current_user=current_user,
            action="CREATE_TENANT",
            conn=conn,
            target_tenant_id=int(result["tenant_id"]),
            detail={
                "billing_mode": payload.billing_mode,
                "access": payload.access,
                "plan_id": payload.plan_id,
            },
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/tenants/{tenant_id}/billing")
def master_update_tenant_billing(
    tenant_id: int,
    payload: UpdateTenantBillingRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    if tenant_id == int(settings.master_customer_id):
        raise HTTPException(status_code=404, detail="Tenant not found")
    conn = _db_conn()
    try:
        try:
            result = update_tenant_billing(
                conn=conn,
                tenant_id=tenant_id,
                master_tenant_id=int(settings.master_customer_id),
                billing_mode=payload.billing_mode,  # type: ignore[arg-type]
                subscription_status=payload.subscription_status,  # type: ignore[arg-type]
                plan_id=payload.plan_id,
                max_employees=payload.max_employees,
                trial_days=payload.trial_days,
                billing_notes=payload.billing_notes,
                rota_advanced_addon=payload.rota_advanced_addon,
                rota_multi_site_addon=payload.rota_multi_site_addon,
                crm_addon=payload.crm_addon,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(
            request=request,
            current_user=current_user,
            action="UPDATE_TENANT_BILLING",
            conn=conn,
            target_tenant_id=tenant_id,
            detail={"billing_mode": payload.billing_mode, "subscription_status": payload.subscription_status},
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.get("/tenants/duplicate-trials/preview")
def master_preview_duplicate_tenants(
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        result = cleanup_duplicate_tenants(
            conn=conn,
            master_tenant_id=int(settings.master_customer_id),
            master_username=current_user.username,
            dry_run=True,
        )
        _audit(
            request=request,
            current_user=current_user,
            action="PREVIEW_DUPLICATE_TENANTS",
            conn=conn,
            detail={"removed_count": len(result.get("removed") or [])},
        )
        conn.commit()
        return result
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Duplicate trial preview failed")
        raise HTTPException(status_code=500, detail=f"Could not preview duplicates: {exc}") from exc
    finally:
        conn.close()


@router.post("/tenants/cleanup-duplicates")
def master_cleanup_duplicate_tenants(
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
    payload: CleanupDuplicatesRequest = Body(default_factory=CleanupDuplicatesRequest),
    dry_run: bool | None = Query(default=None),
) -> dict[str, object]:
    confirm = payload.confirm
    if dry_run is not None:
        confirm = not dry_run
    conn = _db_conn()
    try:
        result = cleanup_duplicate_tenants(
            conn=conn,
            master_tenant_id=int(settings.master_customer_id),
            master_username=current_user.username,
            dry_run=not confirm,
        )
        _audit(
            request=request,
            current_user=current_user,
            action="CLEANUP_DUPLICATE_TENANTS",
            conn=conn,
            detail={
                "dry_run": not confirm,
                "removed_count": len(result.get("removed") or []),
                "deleted_count": result.get("deleted_count", 0),
            },
        )
        conn.commit()
        return result
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Duplicate trial cleanup failed")
        raise HTTPException(
            status_code=500,
            detail=(
                f"Duplicate cleanup failed: {exc}. "
                "Ensure migrations 065_master_platform_ops.sql and 067_tenants_updated_at.sql have been applied on the server."
            ),
        ) from exc
    finally:
        conn.close()


@router.get("/tenants/{tenant_id}")
def master_tenant_detail(
    tenant_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    if tenant_id == int(settings.master_customer_id):
        raise HTTPException(status_code=404, detail="Tenant not found")

    conn = _db_conn()
    try:
        detail = get_tenant_detail(
            conn=conn,
            master_tenant_id=int(settings.master_customer_id),
            tenant_id=tenant_id,
        )
        if not detail:
            raise HTTPException(status_code=404, detail="Tenant not found")

        _audit(
            request=request,
            current_user=current_user,
            action="VIEW_TENANT",
            conn=conn,
            target_tenant_id=tenant_id,
        )
        conn.commit()
        return {"tenant": detail}
    finally:
        conn.close()


@router.post("/tenants/{tenant_id}/impersonate")
def master_impersonate_tenant(
    tenant_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    master_tid = int(settings.master_customer_id)
    if tenant_id == master_tid:
        raise HTTPException(status_code=400, detail="Cannot impersonate the platform master tenant")

    conn = _db_conn()
    try:
        from modules.master.impersonation import start_impersonation

        try:
            payload = start_impersonation(
                settings=settings,
                conn=conn,
                master_username=current_user.username,
                tenant_id=tenant_id,
                master_tenant_id=master_tid,
                ip_address=client_ip(request),
                user_agent=request.headers.get("User-Agent"),
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        conn.commit()
        return payload
    finally:
        conn.close()


@router.post("/tenants/{tenant_id}/suspend")
def master_suspend_tenant(
    tenant_id: int,
    payload: SuspendRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = suspend_tenant(
                conn=conn,
                tenant_id=tenant_id,
                master_tenant_id=int(settings.master_customer_id),
                master_username=current_user.username,
                reason=payload.reason,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(
            request=request,
            current_user=current_user,
            action="SUSPEND_TENANT",
            conn=conn,
            target_tenant_id=tenant_id,
            detail={"reason": payload.reason},
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/tenants/{tenant_id}/unsuspend")
def master_unsuspend_tenant(
    tenant_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = unsuspend_tenant(
                conn=conn,
                tenant_id=tenant_id,
                master_tenant_id=int(settings.master_customer_id),
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(request=request, current_user=current_user, action="UNSUSPEND_TENANT", conn=conn, target_tenant_id=tenant_id)
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/tenants/{tenant_id}/delete")
def master_delete_tenant(
    tenant_id: int,
    payload: DeleteTenantRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = soft_delete_tenant(
                conn=conn,
                tenant_id=tenant_id,
                master_tenant_id=int(settings.master_customer_id),
                master_username=current_user.username,
                confirm_name=payload.confirm_name,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(request=request, current_user=current_user, action="DELETE_TENANT", conn=conn, target_tenant_id=tenant_id)
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/tenants/{tenant_id}/restore")
def master_restore_tenant(
    tenant_id: int,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = restore_tenant(
                conn=conn,
                tenant_id=tenant_id,
                master_tenant_id=int(settings.master_customer_id),
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(request=request, current_user=current_user, action="RESTORE_TENANT", conn=conn, target_tenant_id=tenant_id)
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/tenants/{tenant_id}/extend-trial")
def master_extend_trial(
    tenant_id: int,
    payload: ExtendTrialRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = extend_trial(
                conn=conn,
                tenant_id=tenant_id,
                master_tenant_id=int(settings.master_customer_id),
                days=payload.days,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(
            request=request,
            current_user=current_user,
            action="EXTEND_TRIAL",
            conn=conn,
            target_tenant_id=tenant_id,
            detail={"days": payload.days},
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.put("/tenants/{tenant_id}/notes")
def master_save_notes(
    tenant_id: int,
    payload: InternalNotesRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = save_internal_notes(
                conn=conn,
                tenant_id=tenant_id,
                master_tenant_id=int(settings.master_customer_id),
                notes=payload.notes,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(
            request=request,
            current_user=current_user,
            action="SAVE_TENANT_NOTES",
            conn=conn,
            target_tenant_id=tenant_id,
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/tenants/{tenant_id}/email")
def master_email_tenant(
    tenant_id: int,
    payload: EmailTenantRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = email_tenant_contact(
                conn=conn,
                tenant_id=tenant_id,
                master_tenant_id=int(settings.master_customer_id),
                subject=payload.subject,
                body=payload.body,
                master_username=current_user.username,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Tenant not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        _audit(
            request=request,
            current_user=current_user,
            action="EMAIL_TENANT",
            conn=conn,
            target_tenant_id=tenant_id,
            detail={"subject": payload.subject},
        )
        conn.commit()
        return result
    finally:
        conn.close()


@router.get("/audit-log")
def master_audit_log(
    current_user: Annotated[AuthUser, Depends(get_master_user)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None, max_length=80),
    tenant_id: int | None = Query(default=None),
) -> dict[str, object]:
    conn = _db_conn()
    try:
        return list_master_audit_log(
            conn=conn,
            limit=limit,
            offset=offset,
            action=action,
            tenant_id=tenant_id,
        )
    finally:
        conn.close()


@router.get("/email-log")
def master_email_log(
    current_user: Annotated[AuthUser, Depends(get_master_user)],
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    conn = _db_conn()
    try:
        return list_email_log(conn=conn, limit=limit, offset=offset)
    finally:
        conn.close()


@router.get("/settings")
def master_platform_settings(
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    return platform_settings_snapshot(settings)


@router.get("/api-keys")
def master_api_keys(
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    return api_keys_snapshot()


@router.get("/account")
def master_account(
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            profile = master_account_profile(
                conn=conn,
                master_tenant_id=int(settings.master_customer_id),
                username=current_user.username,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail="Master account not found") from exc
        return profile
    finally:
        conn.close()


@router.post("/account/change-password")
def master_change_password(
    payload: ChangePasswordRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = change_master_password(
                conn=conn,
                master_tenant_id=int(settings.master_customer_id),
                username=current_user.username,
                current_password=payload.current_password,
                new_password=payload.new_password,
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit(request=request, current_user=current_user, action="CHANGE_MASTER_PASSWORD", conn=conn)
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/account/disable-mfa")
def master_disable_mfa(
    payload: DisableMfaRequest,
    request: Request,
    current_user: Annotated[AuthUser, Depends(get_master_user)],
) -> dict[str, object]:
    conn = _db_conn()
    try:
        try:
            result = disable_master_mfa(
                conn=conn,
                master_tenant_id=int(settings.master_customer_id),
                username=current_user.username,
                current_password=payload.current_password,
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        _audit(request=request, current_user=current_user, action="DISABLE_MASTER_MFA", conn=conn)
        conn.commit()
        return result
    finally:
        conn.close()
