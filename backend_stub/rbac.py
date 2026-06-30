"""Role-based access control for B2B HR tenants."""

from __future__ import annotations

LEGACY_ROLE_MAP = {
    "admin": "admin",
    "hr": "hr_manager",
    "employee": "employee",
}

WORKSPACE_ROLES: tuple[str, ...] = (
    "owner",
    "hr_manager",
    "general_manager",
    "supervisor",
    "document_manager",
)

WORKSPACE_ROLE_LABELS: dict[str, str] = {
    "owner": "Owner",
    "hr_manager": "HR manager",
    "general_manager": "General manager",
    "supervisor": "Supervisor",
    "document_manager": "Document manager",
}


PERMISSIONS: dict[str, set[str]] = {
    "owner": {
        "employees.read",
        "employees.write",
        "employees.delete",
        "payroll.read",
        "payroll.write",
        "disciplinary.read",
        "disciplinary.write",
        "compliance.read",
        "compliance.write",
        "settings.read",
        "settings.write",
        "billing.read",
        "billing.write",
        "audit.read",
        "workspace.users.manage",
    },
    "hr_manager": {
        "employees.read",
        "employees.write",
        "payroll.read",
        "payroll.write",
        "disciplinary.read",
        "disciplinary.write",
        "compliance.read",
        "compliance.write",
        "settings.read",
        "audit.read",
        "workspace.users.manage",
    },
    "general_manager": {
        "employees.read",
        "employees.write",
        "payroll.read",
        "disciplinary.read",
        "compliance.read",
    },
    "supervisor": {
        "employees.read",
        "compliance.read",
    },
    "document_manager": {
        "employees.read",
        "compliance.read",
        "compliance.write",
    },
    "employee": {
        "employees.read.self",
    },
    "admin": {
        "employees.read",
        "employees.write",
        "payroll.read",
        "payroll.write",
        "disciplinary.read",
        "disciplinary.write",
        "compliance.read",
        "compliance.write",
        "settings.read",
        "settings.write",
        "billing.read",
        "billing.write",
        "audit.read",
    },
}


def normalize_role(role: str) -> str:
    return LEGACY_ROLE_MAP.get(role, role)


def effective_role(user: object) -> str:
    workspace_role = getattr(user, "workspace_role", None)
    if workspace_role:
        return normalize_role(str(workspace_role))
    role = getattr(user, "role", "")
    return normalize_role(str(role))


def has_permission(role: str, permission: str) -> bool:
    normalized = normalize_role(role)
    allowed = PERMISSIONS.get(normalized, set())
    if permission in allowed:
        return True
    wildcard = permission.split(".")[0] + ".read"
    return wildcard in allowed and permission.endswith(".read")


def require_permission(role: str, permission: str) -> None:
    if not has_permission(role, permission):
        raise PermissionError(f"Role '{role}' lacks permission '{permission}'")
