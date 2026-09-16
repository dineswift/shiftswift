"""FastAPI routes for UK Sponsor Licence mandatory safeguards."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from config import load_settings
from deps import AuthUser, get_hr_user, resolve_tenant_id
from sponsor_licence_compliance import (
    UK_RTW_CHECKLIST_URL,
    absence_monitoring_dashboard,
    absence_type_catalog,
    add_advertisement_link,
    compliance_dashboard,
    create_advertisement_record,
    delete_sponsored_absence_day,
    evaluate_day9_absence_alerts,
    get_absence_monitoring_detail,
    get_absence_streak_summaries,
    get_advertisement_record,
    get_rtw_check,
    list_advertisement_records,
    list_rtw_checks,
    list_sponsored_absence_days,
    list_working_calendar,
    log_sms_reportable_change,
    mark_absence_returned,
    mark_absence_sms_reported,
    record_sponsored_absence_day,
    recruitment_reference_links,
    refresh_sms_change_alert_statuses,
    send_rtw_expiry_reminder,
    store_immutable_rtw_pdf,
    store_advertisement_evidence,
    upsert_working_calendar,
)

router = APIRouter(prefix="/compliance/sponsor-licence", tags=["Sponsor Licence Compliance"])
settings = load_settings()


def _require_sponsor_compliance_plan(*, tenant_id: int, conn: Any) -> None:
    from plan_features import assert_tenant_feature

    assert_tenant_feature(tenant_id=tenant_id, feature="sponsor_compliance", conn=conn)


def _require_sponsor_compliance_access(*, tenant_id: int, conn: Any) -> None:
    _require_sponsor_compliance_plan(tenant_id=tenant_id, conn=conn)
    from sponsor_licence_ack import assert_sponsor_licence_acknowledged

    assert_sponsor_licence_acknowledged(tenant_id=tenant_id, conn=conn)


class SponsorLicenceAckRequest(BaseModel):
    holds_sponsor_licence: bool
    accept_terms: bool = Field(description="Must be true to record acknowledgement.")


class SmsChangeRequest(BaseModel):
    employee_id: int
    field_name: str = Field(pattern="^(job_title|salary|work_location)$")
    old_value: str | None = None
    new_value: str | None = None


class AdvertLinkInput(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=8, max_length=2048)
    type: str = "listing"


class AdvertisementRecordRequest(BaseModel):
    job_title: str = Field(min_length=1, max_length=200)
    platform: str = Field(min_length=1, max_length=120)
    advert_url: str = Field(min_length=8, max_length=2048)
    posted_date: date
    job_reference: str | None = Field(default=None, max_length=120)
    soc_code: str | None = Field(default=None, max_length=20)
    vacancy_id: int | None = None
    advert_reference: str | None = Field(default=None, max_length=120)
    closing_date: date | None = None
    is_sponsored_vacancy: bool = True
    rlmt_applicable: bool = True
    minimum_advertising_days: int = Field(default=28, ge=1, le=365)
    additional_links: list[AdvertLinkInput] = Field(default_factory=list)
    extra_links: list[AdvertLinkInput] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=4000)


class AdvertisementLinkRequest(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=8, max_length=2048)
    type: str = "listing"


class MarkAbsenceReportedRequest(BaseModel):
    home_office_report_reference: str | None = Field(default=None, max_length=120)


def _db_conn() -> Any:
    import os

    import psycopg2

    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    return psycopg2.connect(url)


async def _read_validated_pdf(upload: UploadFile) -> bytes:
    if upload.content_type not in {None, "application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Only PDF uploads are allowed")
    pdf_bytes = await upload.read()
    if len(pdf_bytes) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="PDF exceeds maximum upload size")
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF file")
    return pdf_bytes


@router.get("/acknowledgement")
def sponsor_licence_ack_status(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    from sponsor_licence_ack import get_sponsor_licence_ack_status

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_plan(tenant_id=tenant_id, conn=conn)
        return get_sponsor_licence_ack_status(tenant_id=tenant_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/acknowledgement")
def sponsor_licence_acknowledge(
    payload: SponsorLicenceAckRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    from sponsor_licence_ack import acknowledge_sponsor_licence

    if not payload.accept_terms:
        raise HTTPException(status_code=400, detail="You must accept sponsor duty terms.")
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_plan(tenant_id=tenant_id, conn=conn)
        return acknowledge_sponsor_licence(
            tenant_id=tenant_id,
            acknowledged_by=current_user.username,
            holds_sponsor_licence=payload.holds_sponsor_licence,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    else:
        conn.commit()
    finally:
        conn.close()


@router.get("/checklist")
def rtw_checklist_link() -> dict[str, str]:
    return {
        "title": "UK Government Right to Work Checklist",
        "url": UK_RTW_CHECKLIST_URL,
        "note": "Use this official checklist when completing RTW checks.",
    }


@router.get("/rtw-checks")
def list_rtw_check_records(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        return list_rtw_checks(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()


@router.get("/rtw-checks/{check_id}")
def get_rtw_check_record(
    check_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        return get_rtw_check(tenant_id=tenant_id, check_id=check_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/rtw-checks/{check_id}/send-reminder")
def send_rtw_check_reminder(
    check_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        result = send_rtw_expiry_reminder(tenant_id=tenant_id, check_id=check_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    else:
        conn.commit()
        return result
    finally:
        conn.close()


@router.post("/rtw-checks")
async def create_rtw_check(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    employee_id: int = Form(...),
    check_date: date = Form(...),
    check_method: str = Form(...),
    outcome: str = Form(...),
    checker_user_id: str = Form(...),
    expiry_date: date | None = Form(None),
    visa_expiry_date: date | None = Form(None),
    rtw_check_expiry_date: date | None = Form(None),
    gov_checklist_version: str | None = Form(None),
    evidence_pdf: UploadFile = File(...),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    pdf_bytes = await _read_validated_pdf(evidence_pdf)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        stored = store_immutable_rtw_pdf(
            tenant_id=tenant_id,
            employee_id=employee_id,
            pdf_bytes=pdf_bytes,
            check_date=check_date,
            check_method=check_method,
            outcome=outcome,
            checker_user_id=checker_user_id or current_user.username,
            expiry_date=rtw_check_expiry_date or expiry_date,
            visa_expiry_date=visa_expiry_date,
            gov_checklist_version=gov_checklist_version,
            conn=conn,
        )
    finally:
        conn.close()
    return {
        "check_id": stored.check_id,
        "employee_id": stored.employee_id,
        "check_date": stored.check_date.isoformat(),
        "content_sha256": stored.content_sha256,
        "immutable_locked": stored.immutable_locked,
        "gov_checklist_url": stored.gov_checklist_url,
        "storage_path": stored.storage_path,
    }


@router.get("/rtw-checks/{check_id}/file")
def download_rtw_check_file(
    check_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    from fastapi.responses import FileResponse

    from modules.documents.storage import resolve_rtw_file

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT employee_id, check_date, storage_path, content_sha256
                FROM right_to_work_checks
                WHERE tenant_id = %s AND id = %s
                """,
                (tenant_id, check_id),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="RTW check not found")
    employee_id, check_date, storage_path, _digest = row
    path = resolve_rtw_file(tenant_id=tenant_id, storage_path=storage_path)
    filename = f"rtw-check-employee-{employee_id}-{check_date.isoformat()}.pdf"
    return FileResponse(path, media_type="application/pdf", filename=filename)


@router.post("/absence-alerts/run")
def run_absence_alerts(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    as_of: date | None = None,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        alerts = evaluate_day9_absence_alerts(
            tenant_id=tenant_id,
            as_of=as_of or date.today(),
            conn=conn,
        )
    finally:
        conn.close()
    return {"generated": len(alerts), "alerts": alerts}


@router.post("/sms-changes")
def record_sms_change(
    payload: SmsChangeRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    changed_by: str = Header(default="system", alias="X-User-Id"),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        entry = log_sms_reportable_change(
            tenant_id=tenant_id,
            employee_id=payload.employee_id,
            field_name=payload.field_name,
            old_value=payload.old_value,
            new_value=payload.new_value,
            changed_by=changed_by or current_user.username,
            conn=conn,
        )
    finally:
        conn.close()
    if not entry:
        raise HTTPException(status_code=400, detail="No reportable SMS change detected")
    return entry


@router.post("/sms-changes/refresh-statuses")
def refresh_sms_statuses(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    as_of: date | None = None,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        updated = refresh_sms_change_alert_statuses(
            tenant_id=tenant_id,
            as_of=as_of or date.today(),
            conn=conn,
        )
    finally:
        conn.close()
    return {"updated": updated}


@router.get("/dashboard")
def sponsor_dashboard(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        data = compliance_dashboard(tenant_id=tenant_id, conn=conn)
    finally:
        conn.close()
    return data


@router.get("/recruitment-links")
def recruitment_links() -> dict[str, Any]:
    return {"links": recruitment_reference_links()}


@router.get("/advertisement-records")
def list_adverts(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    status: str | None = None,
    limit: int = 50,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        items = list_advertisement_records(tenant_id=tenant_id, conn=conn, status=status, limit=limit)
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.post("/advertisement-records")
def create_advert(
    payload: AdvertisementRecordRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
    x_user_id: str | None = Header(default="system", alias="X-User-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        record = create_advertisement_record(
            tenant_id=tenant_id,
            job_title=payload.job_title,
            platform=payload.platform,
            advert_url=payload.advert_url,
            posted_date=payload.posted_date,
            job_reference=payload.job_reference,
            soc_code=payload.soc_code,
            vacancy_id=payload.vacancy_id,
            advert_reference=payload.advert_reference,
            closing_date=payload.closing_date,
            is_sponsored_vacancy=payload.is_sponsored_vacancy,
            rlmt_applicable=payload.rlmt_applicable,
            minimum_advertising_days=payload.minimum_advertising_days,
            additional_links=[link.model_dump() for link in payload.additional_links],
            extra_links=[link.model_dump() for link in payload.extra_links],
            notes=payload.notes,
            created_by=x_user_id or current_user.username,
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return record


@router.get("/advertisement-records/{record_id}")
def get_advert(
    record_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        return get_advertisement_record(tenant_id=tenant_id, record_id=record_id, conn=conn)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/advertisement-records/{record_id}/links")
def add_advert_link(
    record_id: int,
    payload: AdvertisementLinkRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        link = add_advertisement_link(
            tenant_id=tenant_id,
            record_id=record_id,
            link_label=payload.label,
            link_url=payload.url,
            link_type=payload.type,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return link


@router.post("/advertisement-records/{record_id}/evidence")
async def upload_advert_evidence(
    record_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    evidence_pdf: UploadFile = File(...),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    pdf_bytes = await _read_validated_pdf(evidence_pdf)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        return store_advertisement_evidence(
            tenant_id=tenant_id,
            record_id=record_id,
            file_bytes=pdf_bytes,
            original_filename=evidence_pdf.filename or "advert-evidence.pdf",
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/advertisement-records/{record_id}/evidence")
def download_advert_evidence(
    record_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    from fastapi.responses import FileResponse

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT evidence_storage_path, job_title
                FROM recruitment_advertisement_records
                WHERE tenant_id = %s AND id = %s
                """,
                (tenant_id, record_id),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row or not row[0]:
        raise HTTPException(status_code=404, detail="Advert evidence not found")
    path = Path(row[0])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Evidence file missing on server")
    safe_title = str(row[1] or "advert").replace(" ", "-")[:40]
    return FileResponse(path, media_type="application/pdf", filename=f"{safe_title}-evidence.pdf")


class AbsenceDayRequest(BaseModel):
    employee_id: int
    absence_date: date
    excuse_type: str = Field(default="unauthorized")
    is_excused: bool | None = None
    source: str = "admin"


class WorkingCalendarEntry(BaseModel):
    calendar_date: date
    is_working_day: bool = True


class WorkingCalendarBulkRequest(BaseModel):
    entries: list[WorkingCalendarEntry] = Field(min_length=1)


class ReportTriggerUpdate(BaseModel):
    status: str = Field(pattern="^(acknowledged|reported|dismissed)$")
    report_reference: str | None = None


@router.get("/absence-types")
def list_absence_types() -> dict[str, object]:
    return {"items": absence_type_catalog()}


@router.get("/absence-days")
def get_absence_days(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    employee_id: int | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = 100,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        items = list_sponsored_absence_days(
            tenant_id=tenant_id,
            conn=conn,
            employee_id=employee_id,
            from_date=from_date,
            to_date=to_date,
            limit=limit,
        )
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.post("/absence-days")
def record_absence_day(
    payload: AbsenceDayRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        result = record_sponsored_absence_day(
            tenant_id=tenant_id,
            employee_id=payload.employee_id,
            absence_date=payload.absence_date,
            excuse_type=payload.excuse_type,
            is_excused=payload.is_excused,
            source=payload.source,
            conn=conn,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return result


@router.delete("/absence-days/{employee_id}/{absence_date}")
def remove_absence_day(
    employee_id: int,
    absence_date: date,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, str]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        deleted = delete_sponsored_absence_day(
            tenant_id=tenant_id,
            employee_id=employee_id,
            absence_date=absence_date,
            conn=conn,
        )
    finally:
        conn.close()
    if not deleted:
        raise HTTPException(status_code=404, detail="Absence day not found")
    return {"status": "deleted"}


@router.get("/absence-streaks")
def absence_streaks(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    as_of: date | None = None,
    lookback_days: int = 30,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        items = get_absence_streak_summaries(
            tenant_id=tenant_id,
            as_of=as_of or date.today(),
            conn=conn,
            lookback_days=lookback_days,
        )
    finally:
        conn.close()
    return {"items": items, "count": len(items), "as_of": (as_of or date.today()).isoformat()}


@router.get("/absence-monitoring")
def get_absence_monitoring(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    as_of: date | None = None,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        return absence_monitoring_dashboard(tenant_id=tenant_id, conn=conn, as_of=as_of or date.today())
    finally:
        conn.close()


@router.get("/absence-monitoring/{employee_id}")
def get_absence_monitoring_record(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    as_of: date | None = None,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        return get_absence_monitoring_detail(
            tenant_id=tenant_id,
            employee_id=employee_id,
            conn=conn,
            as_of=as_of or date.today(),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/absence-monitoring/{employee_id}/mark-sms-reported")
def mark_absence_monitoring_sms_reported(
    employee_id: int,
    payload: MarkAbsenceReportedRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        return mark_absence_sms_reported(
            tenant_id=tenant_id,
            employee_id=employee_id,
            acknowledged_by=current_user.username,
            conn=conn,
            home_office_report_reference=payload.home_office_report_reference,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.post("/absence-monitoring/{employee_id}/mark-returned")
def mark_absence_monitoring_returned(
    employee_id: int,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    as_of: date | None = None,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, Any]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        return mark_absence_returned(
            tenant_id=tenant_id,
            employee_id=employee_id,
            acknowledged_by=current_user.username,
            conn=conn,
            as_of=as_of or date.today(),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()


@router.get("/working-calendar")
def get_working_calendar(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    from_date: date | None = None,
    to_date: date | None = None,
    non_working_only: bool = False,
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        items = list_working_calendar(
            tenant_id=tenant_id,
            conn=conn,
            from_date=from_date,
            to_date=to_date,
            non_working_only=non_working_only,
        )
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.put("/working-calendar")
def update_working_calendar(
    payload: WorkingCalendarBulkRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, int]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        result = upsert_working_calendar(
            tenant_id=tenant_id,
            entries=[entry.model_dump() for entry in payload.entries],
            conn=conn,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        conn.close()
    return result


@router.get("/audit-export")
def audit_export(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    employee_id: int | None = None,
    format: str = "json",
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    from fastapi.responses import Response

    from modules.compliance.audit_export import build_audit_export
    from modules.compliance.audit_pdf import audit_export_pdf_bytes

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        from plan_features import assert_tenant_feature

        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        assert_tenant_feature(tenant_id=tenant_id, feature="audit_export", conn=conn)
        filename = f"audit-pack-tenant-{tenant_id}"
        if employee_id:
            filename += f"-employee-{employee_id}"
        fmt = format.lower()
        if fmt == "pdf":
            pdf_bytes = audit_export_pdf_bytes(
                tenant_id=tenant_id, employee_id=employee_id, conn=conn
            )
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}.pdf"'},
            )
        if fmt == "zip":
            from modules.compliance.audit_export import build_audit_export_zip

            zip_bytes = build_audit_export_zip(
                tenant_id=tenant_id, employee_id=employee_id, conn=conn
            )
            return Response(
                content=zip_bytes,
                media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{filename}.zip"'},
            )
        pack = build_audit_export(tenant_id=tenant_id, employee_id=employee_id, conn=conn)
        for section in ("right_to_work_checks", "employee_documents", "tenant_documents", "identity_documents"):
            for row in pack["sections"].get(section, []):
                row.pop("storage_path", None)
        return pack
    finally:
        conn.close()


class ShareCodeVerifyRequest(BaseModel):
    employee_id: int
    share_code: str = Field(min_length=6, max_length=32)
    date_of_birth: date


@router.post("/rtw-verify-share-code")
def verify_rtw_share_code(
    payload: ShareCodeVerifyRequest,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    from modules.compliance.idsp_rtw import IdspError, idsp_configured, persist_verification, verify_share_code

    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    try:
        verification = verify_share_code(
            share_code=payload.share_code,
            date_of_birth=payload.date_of_birth,
            employee_id=payload.employee_id,
            tenant_id=tenant_id,
        )
    except IdspError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        result = persist_verification(
            conn=conn,
            tenant_id=tenant_id,
            employee_id=payload.employee_id,
            share_code=payload.share_code.strip().upper(),
            verification=verification,
            verified_by=current_user.username,
        )
    finally:
        conn.close()
    result["idsp_configured"] = idsp_configured()
    return result


@router.get("/reporting-triggers")
def list_reporting_triggers(
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    status: str | None = "open",
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, object]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        with conn.cursor() as cur:
            query = """
                SELECT id, employee_id, trigger_type, source_module, description,
                       deadline_date, status, created_at
                FROM sponsor_reporting_triggers WHERE tenant_id = %s
            """
            params: list[Any] = [tenant_id]
            if status:
                query += " AND status = %s"
                params.append(status)
            query += " ORDER BY deadline_date ASC LIMIT 200"
            cur.execute(query, params)
            items = [
                {
                    "id": r[0],
                    "employee_id": r[1],
                    "trigger_type": r[2],
                    "source_module": r[3],
                    "description": r[4],
                    "deadline_date": r[5].isoformat() if r[5] else None,
                    "status": r[6],
                    "created_at": r[7].isoformat() if r[7] else None,
                }
                for r in cur.fetchall()
            ]
    finally:
        conn.close()
    return {"items": items, "count": len(items)}


@router.patch("/reporting-triggers/{trigger_id}")
def update_reporting_trigger(
    trigger_id: int,
    payload: ReportTriggerUpdate,
    current_user: Annotated[AuthUser, Depends(get_hr_user)],
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> dict[str, str]:
    tenant_id = resolve_tenant_id(current_user, x_tenant_id, settings=settings)
    conn = _db_conn()
    try:
        _require_sponsor_compliance_access(tenant_id=tenant_id, conn=conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sponsor_reporting_triggers
                SET status = %s,
                    reported_by = CASE WHEN %s = 'reported' THEN %s ELSE reported_by END,
                    reported_at = CASE WHEN %s = 'reported' THEN NOW() ELSE reported_at END,
                    report_reference = COALESCE(%s, report_reference)
                WHERE tenant_id = %s AND id = %s
                """,
                (
                    payload.status,
                    payload.status,
                    current_user.username,
                    payload.status,
                    payload.report_reference,
                    tenant_id,
                    trigger_id,
                ),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Trigger not found")
        conn.commit()
    finally:
        conn.close()
    return {"status": payload.status}
