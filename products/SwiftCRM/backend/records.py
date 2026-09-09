"""Suppliers, house insurance, compliance diary, and document uploads."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from data import diary_status, execute, row, rows, upload_dir
from phones import to_e164

router = APIRouter()

SUPPLIER_KINDS = ("gas", "electricity", "maintenance", "insurance", "other")
POLICY_KINDS = ("buildings", "contents", "landlord", "rent_guarantee")
COMPLIANCE_KINDS = (
    "gas_safety",
    "eicr",
    "epc",
    "smoke_alarms",
    "legionella",
    "hmo_licence",
    "insurance",
    "ast",
    "inventory",
)
DOC_KINDS = ("ast", "inventory", "gas", "eicr", "epc", "insurance", "licence", "other")
SIGNED = ("unsigned", "sent", "signed", "n/a")
MAX_UPLOAD = 8 * 1024 * 1024


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def gbp(pence: int | None) -> float | None:
    if pence is None:
        return None
    return round(pence / 100, 2)


def apply_patch(table: str, item_id: int, allowed: dict[str, Any]) -> None:
    fields = {k: v for k, v in allowed.items() if v is not None}
    if not fields:
        return
    sets = ", ".join(f"{key} = ?" for key in fields)
    execute(f"UPDATE {table} SET {sets} WHERE id = ?", (*fields.values(), item_id))


def decorate_supplier(item: dict[str, Any]) -> dict[str, Any]:
    assigned = rows(
        """SELECT ps.role, ps.account_ref, ps.notes, p.id AS property_id, p.name AS property_name, p.city
           FROM property_suppliers ps
           JOIN properties p ON p.id = ps.property_id
           WHERE ps.supplier_id = ?
           ORDER BY p.name""",
        (item["id"],),
    )
    return {**item, "properties": assigned}


def decorate_policy(item: dict[str, Any]) -> dict[str, Any]:
    broker = row("SELECT id, name, email, phone FROM suppliers WHERE id = ?", (item["broker_id"],)) if item.get("broker_id") else None
    prop = row("SELECT id, name FROM properties WHERE id = ?", (item["property_id"],))
    return {
        **item,
        "excess": gbp(item["excess_pence"]),
        "broker": broker,
        "property": prop,
        "status": diary_status(item.get("end_on")),
    }


def decorate_compliance(item: dict[str, Any]) -> dict[str, Any]:
    status = diary_status(item.get("due_on"), booked=item.get("status") == "booked")
    if item.get("status") == "booked":
        status = "booked"
    elif item.get("due_on"):
        status = diary_status(item["due_on"])
    supplier = (
        row("SELECT id, name, kind FROM suppliers WHERE id = ?", (item["supplier_id"],))
        if item.get("supplier_id")
        else None
    )
    prop = row("SELECT id, name, city FROM properties WHERE id = ?", (item["property_id"],))
    return {**item, "status": status, "supplier": supplier, "property": prop}


def decorate_document(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **item,
        "url": f"/documents/{item['id']}/file",
        "property": row("SELECT id, name FROM properties WHERE id = ?", (item["property_id"],)) if item.get("property_id") else None,
        "supplier": row("SELECT id, name FROM suppliers WHERE id = ?", (item["supplier_id"],)) if item.get("supplier_id") else None,
    }


def property_record_bundle(property_id: int) -> dict[str, Any]:
    suppliers = rows(
        """SELECT s.*, ps.role, ps.account_ref AS property_account, ps.notes AS assignment_notes
           FROM property_suppliers ps
           JOIN suppliers s ON s.id = ps.supplier_id
           WHERE ps.property_id = ?
           ORDER BY ps.role, s.name""",
        (property_id,),
    )
    policies = [decorate_policy(p) for p in rows("SELECT * FROM policies WHERE property_id = ? ORDER BY end_on", (property_id,))]
    compliance = [
        decorate_compliance(c)
        for c in rows("SELECT * FROM compliance_items WHERE property_id = ? ORDER BY due_on IS NULL, due_on", (property_id,))
    ]
    documents = [
        decorate_document(d)
        for d in rows("SELECT * FROM documents WHERE property_id = ? ORDER BY id DESC", (property_id,))
    ]
    supplier_messages = rows(
        """SELECT * FROM communications
           WHERE property_id = ? AND audience = 'supplier'
           ORDER BY created_at DESC LIMIT 20""",
        (property_id,),
    )
    return {
        "suppliers": suppliers,
        "policies": policies,
        "compliance": compliance,
        "documents": documents,
        "supplier_communications": supplier_messages,
    }


def safe_filename(name: str) -> str:
    base = Path(name or "upload").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "upload"
    return cleaned[:80]


class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: str = Field(pattern="^(gas|electricity|maintenance|insurance|other)$")
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    account_ref: str | None = None
    notes: str | None = None
    preferred_channel: str | None = None


class SupplierPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    kind: str | None = Field(default=None, pattern="^(gas|electricity|maintenance|insurance|other)$")
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    account_ref: str | None = None
    notes: str | None = None
    preferred_channel: str | None = None


class AssignSupplier(BaseModel):
    supplier_id: int
    role: str = Field(pattern="^(gas|electricity|maintenance|insurance|other)$")
    account_ref: str | None = None
    notes: str | None = None


class PolicyCreate(BaseModel):
    property_id: int
    kind: str = Field(pattern="^(buildings|contents|landlord|rent_guarantee)$")
    insurer: str = Field(min_length=1, max_length=160)
    policy_number: str | None = None
    broker_id: int | None = None
    start_on: str | None = None
    end_on: str | None = None
    excess: float | None = Field(default=None, ge=0)
    notes: str | None = None


class PolicyPatch(BaseModel):
    kind: str | None = None
    insurer: str | None = None
    policy_number: str | None = None
    broker_id: int | None = None
    start_on: str | None = None
    end_on: str | None = None
    excess: float | None = Field(default=None, ge=0)
    notes: str | None = None


class ComplianceCreate(BaseModel):
    property_id: int
    kind: str
    title: str = Field(min_length=1, max_length=200)
    reference: str | None = None
    issued_on: str | None = None
    due_on: str | None = None
    supplier_id: int | None = None
    notes: str | None = None
    booked: bool = False


class CompliancePatch(BaseModel):
    title: str | None = None
    reference: str | None = None
    issued_on: str | None = None
    due_on: str | None = None
    supplier_id: int | None = None
    notes: str | None = None
    status: str | None = Field(default=None, pattern="^(current|due_soon|overdue|booked|missing)$")


class DocumentPatch(BaseModel):
    signed_status: str = Field(pattern="^(unsigned|sent|signed|n/a)$")
    title: str | None = None


def bind(require_agency):
    @router.get("/suppliers")
    def list_suppliers(
        kind: str | None = None,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if kind:
            items = rows("SELECT * FROM suppliers WHERE kind = ? ORDER BY name", (kind,))
        else:
            items = rows("SELECT * FROM suppliers ORDER BY kind, name")
        return {"suppliers": [decorate_supplier(s) for s in items]}

    @router.post("/suppliers")
    def create_supplier(body: SupplierCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        new_id = execute(
            """INSERT INTO suppliers (name, kind, contact_name, email, phone, phone_e164, account_ref, notes, preferred_channel)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                body.name,
                body.kind,
                body.contact_name,
                body.email,
                body.phone,
                to_e164(body.phone),
                body.account_ref,
                body.notes,
                body.preferred_channel or "email",
            ),
        )
        return decorate_supplier(row("SELECT * FROM suppliers WHERE id = ?", (new_id,)) or {})

    @router.get("/suppliers/{supplier_id}")
    def get_supplier(supplier_id: int, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        item = row("SELECT * FROM suppliers WHERE id = ?", (supplier_id,))
        if not item:
            raise HTTPException(status_code=404, detail="Supplier not found")
        messages = rows(
            "SELECT * FROM communications WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 30",
            (supplier_id,),
        )
        return {**decorate_supplier(item), "communications": messages}

    @router.patch("/suppliers/{supplier_id}")
    def patch_supplier(
        supplier_id: int,
        body: SupplierPatch,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM suppliers WHERE id = ?", (supplier_id,)):
            raise HTTPException(status_code=404, detail="Supplier not found")
        payload = body.model_dump(exclude_unset=True)
        if "phone" in payload:
            payload["phone_e164"] = to_e164(payload.get("phone"))
        apply_patch("suppliers", supplier_id, payload)
        return decorate_supplier(row("SELECT * FROM suppliers WHERE id = ?", (supplier_id,)) or {})

    @router.post("/properties/{property_id}/suppliers")
    def assign_supplier(
        property_id: int,
        body: AssignSupplier,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM properties WHERE id = ?", (property_id,)):
            raise HTTPException(status_code=404, detail="Property not found")
        if not row("SELECT id FROM suppliers WHERE id = ?", (body.supplier_id,)):
            raise HTTPException(status_code=404, detail="Supplier not found")
        execute(
            """INSERT INTO property_suppliers (property_id, supplier_id, role, account_ref, notes)
               VALUES (?,?,?,?,?)
               ON CONFLICT(property_id, supplier_id, role) DO UPDATE SET
                 account_ref = excluded.account_ref, notes = excluded.notes""",
            (property_id, body.supplier_id, body.role, body.account_ref, body.notes),
        )
        return property_record_bundle(property_id)

    @router.delete("/properties/{property_id}/suppliers/{supplier_id}")
    def unassign_supplier(
        property_id: int,
        supplier_id: int,
        role: str | None = None,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if role:
            execute(
                "DELETE FROM property_suppliers WHERE property_id = ? AND supplier_id = ? AND role = ?",
                (property_id, supplier_id, role),
            )
        else:
            execute(
                "DELETE FROM property_suppliers WHERE property_id = ? AND supplier_id = ?",
                (property_id, supplier_id),
            )
        return property_record_bundle(property_id)

    @router.get("/compliance")
    def list_compliance(authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        items = [decorate_compliance(c) for c in rows("SELECT * FROM compliance_items")]
        items.sort(key=lambda c: (c.get("due_on") is None, c.get("due_on") or "9999", c["id"]))
        due = [c for c in items if c["status"] in {"overdue", "due_soon", "booked"}]
        return {"compliance": items, "attention": due}

    @router.post("/compliance")
    def create_compliance(body: ComplianceCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        if body.kind not in COMPLIANCE_KINDS:
            raise HTTPException(status_code=400, detail="Unknown compliance type")
        status = "booked" if body.booked else diary_status(body.due_on)
        new_id = execute(
            """INSERT INTO compliance_items
               (property_id, kind, title, reference, issued_on, due_on, status, supplier_id, notes)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                body.property_id,
                body.kind,
                body.title,
                body.reference,
                body.issued_on,
                body.due_on,
                status,
                body.supplier_id,
                body.notes,
            ),
        )
        return decorate_compliance(row("SELECT * FROM compliance_items WHERE id = ?", (new_id,)) or {})

    @router.patch("/compliance/{item_id}")
    def patch_compliance(
        item_id: int,
        body: CompliancePatch,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM compliance_items WHERE id = ?", (item_id,)):
            raise HTTPException(status_code=404, detail="Compliance item not found")
        payload = body.model_dump(exclude_unset=True)
        if "due_on" in payload and "status" not in payload:
            payload["status"] = diary_status(payload.get("due_on"), booked=False)
        apply_patch("compliance_items", item_id, payload)
        return decorate_compliance(row("SELECT * FROM compliance_items WHERE id = ?", (item_id,)) or {})

    @router.get("/policies")
    def list_policies(
        property_id: int | None = None,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if property_id:
            items = rows("SELECT * FROM policies WHERE property_id = ? ORDER BY end_on", (property_id,))
        else:
            items = rows("SELECT * FROM policies ORDER BY end_on")
        return {"policies": [decorate_policy(p) for p in items]}

    @router.post("/policies")
    def create_policy(body: PolicyCreate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM properties WHERE id = ?", (body.property_id,)):
            raise HTTPException(status_code=404, detail="Property not found")
        new_id = execute(
            """INSERT INTO policies (property_id, kind, insurer, policy_number, broker_id, start_on, end_on, excess_pence, notes)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                body.property_id,
                body.kind,
                body.insurer,
                body.policy_number,
                body.broker_id,
                body.start_on,
                body.end_on,
                int(round((body.excess or 0) * 100)),
                body.notes,
            ),
        )
        return decorate_policy(row("SELECT * FROM policies WHERE id = ?", (new_id,)) or {})

    @router.patch("/policies/{policy_id}")
    def patch_policy(
        policy_id: int,
        body: PolicyPatch,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM policies WHERE id = ?", (policy_id,)):
            raise HTTPException(status_code=404, detail="Policy not found")
        payload = body.model_dump(exclude_unset=True)
        if "excess" in payload:
            payload["excess_pence"] = int(round(float(payload.pop("excess") or 0) * 100))
        apply_patch("policies", policy_id, payload)
        return decorate_policy(row("SELECT * FROM policies WHERE id = ?", (policy_id,)) or {})

    @router.get("/documents")
    def list_documents(
        property_id: int | None = None,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if property_id:
            items = rows("SELECT * FROM documents WHERE property_id = ? ORDER BY id DESC", (property_id,))
        else:
            items = rows("SELECT * FROM documents ORDER BY id DESC")
        return {"documents": [decorate_document(d) for d in items]}

    @router.post("/documents")
    async def upload_document(
        authorization: str | None = Header(default=None),
        file: UploadFile = File(...),
        title: str = Form(""),
        kind: str = Form("other"),
        property_id: int | None = Form(default=None),
        tenancy_id: int | None = Form(default=None),
        supplier_id: int | None = Form(default=None),
        compliance_id: int | None = Form(default=None),
        policy_id: int | None = Form(default=None),
        signed_status: str = Form("n/a"),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if kind not in DOC_KINDS:
            raise HTTPException(status_code=400, detail="Unknown document type")
        if signed_status not in SIGNED:
            signed_status = "n/a"
        data = await file.read()
        if len(data) > MAX_UPLOAD:
            raise HTTPException(status_code=400, detail="File is larger than 8 MB")
        if not data:
            raise HTTPException(status_code=400, detail="Empty file")
        stored = f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{safe_filename(file.filename or 'upload')}"
        path = upload_dir() / stored
        path.write_bytes(data)
        new_id = execute(
            """INSERT INTO documents
               (created_at, property_id, tenancy_id, supplier_id, compliance_id, policy_id, kind, title, filename, mime, size_bytes, stored_name, signed_status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                now_iso(),
                property_id,
                tenancy_id,
                supplier_id,
                compliance_id,
                policy_id,
                kind,
                title or (file.filename or "Document"),
                file.filename or stored,
                file.content_type or "application/octet-stream",
                len(data),
                stored,
                signed_status,
            ),
        )
        return decorate_document(row("SELECT * FROM documents WHERE id = ?", (new_id,)) or {})

    @router.get("/documents/{document_id}/file")
    def download_document(
        document_id: int,
        authorization: str | None = Header(default=None),
        token: str | None = Query(default=None),
    ) -> FileResponse:
        bearer = authorization
        if not bearer and token:
            bearer = f"Bearer {token}"
        require_agency(bearer)
        item = row("SELECT * FROM documents WHERE id = ?", (document_id,))
        if not item:
            raise HTTPException(status_code=404, detail="Document not found")
        path = upload_dir() / item["stored_name"]
        if not path.exists():
            raise HTTPException(status_code=404, detail="File missing on disk")
        return FileResponse(path, filename=item["filename"], media_type=item["mime"] or "application/octet-stream")

    @router.patch("/documents/{document_id}")
    def patch_document(
        document_id: int,
        body: DocumentPatch,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_agency(authorization)
        if not row("SELECT id FROM documents WHERE id = ?", (document_id,)):
            raise HTTPException(status_code=404, detail="Document not found")
        apply_patch("documents", document_id, body.model_dump(exclude_unset=True))
        return decorate_document(row("SELECT * FROM documents WHERE id = ?", (document_id,)) or {})

    return router
