"""EPOS integration HTTP routes — device token auth, no employee JWT."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from core.database import get_connection
from deps import client_ip
from modules.time_punch import epos as epos_service
from modules.time_punch.epos import EposAction, EposPunchError

router = APIRouter(prefix="/integrations/v1/epos", tags=["EPOS integration"])


class EposPunchRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=6)
    employee_id: int
    action: EposAction = "toggle"
    external_ref: str | None = Field(default=None, max_length=120)
    device_clock: str | None = Field(default=None, max_length=40)


def _extract_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail={"ok": False, "error": "invalid_token", "message": "Invalid integration token"})
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail={"ok": False, "error": "invalid_token", "message": "Invalid integration token"})
    return token


def get_epos_integration(authorization: Annotated[str | None, Header()] = None) -> dict:
    bearer = _extract_bearer(authorization)
    conn = get_connection()
    try:
        return epos_service.resolve_integration_token(bearer_token=bearer, conn=conn)
    except EposPunchError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"ok": False, "error": exc.error, "message": exc.message},
        ) from exc
    finally:
        conn.close()


@router.get("/site")
def epos_site(integration: Annotated[dict, Depends(get_epos_integration)]) -> dict[str, object]:
    conn = get_connection()
    try:
        return epos_service.site_bootstrap(integration=integration, conn=conn)
    except EposPunchError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"ok": False, "error": exc.error, "message": exc.message},
        ) from exc
    finally:
        conn.close()


@router.post("/punch")
def epos_punch(
    payload: EposPunchRequest,
    request: Request,
    integration: Annotated[dict, Depends(get_epos_integration)],
) -> dict[str, object]:
    conn = get_connection()
    try:
        return epos_service.record_epos_punch(
            integration=integration,
            employee_id=payload.employee_id,
            pin=payload.pin,
            action=payload.action,
            external_ref=payload.external_ref,
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            conn=conn,
        )
    except EposPunchError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"ok": False, "error": exc.error, "message": exc.message},
        ) from exc
    finally:
        conn.close()
