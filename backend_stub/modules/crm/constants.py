"""CRM constants — default pipeline stages (inspired by mini-crm / Bigin-style model)."""

from __future__ import annotations

DEFAULT_PIPELINE_NAME = "Sales pipeline"

DEFAULT_STAGES: tuple[tuple[str, str, bool, bool], ...] = (
    ("lead", "Lead", False, False),
    ("qualified", "Qualified", False, False),
    ("proposal", "Proposal", False, False),
    ("negotiation", "Negotiation", False, False),
    ("won", "Won", True, False),
    ("lost", "Lost", False, True),
)

ACTIVITY_TYPES = frozenset({"note", "call", "email", "meeting"})
