"""Offboarding domain errors."""

from __future__ import annotations


class ActiveWorkflowExistsError(Exception):
    def __init__(self, workflow_id: int, employee_id: int) -> None:
        self.workflow_id = workflow_id
        self.employee_id = employee_id
        super().__init__(f"Active offboarding workflow already exists for employee {employee_id}")

    def as_detail(self) -> dict[str, object]:
        return {
            "message": "This employee already has an active offboarding workflow.",
            "existing_workflow_id": self.workflow_id,
            "employee_id": self.employee_id,
        }


class WorkflowStateError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)
