"""SwiftHelp unit tests — login, tickets, requester isolation."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

TMP = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["SWIFTHELP_DB"] = TMP.name
TMP.close()

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from data import DEMO_EMAIL, DEMO_PASSWORD, init_db, row, rows, verify_password  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402


class SeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        init_db()
        cls.client = TestClient(app)

    def test_hashed_agent(self) -> None:
        user = row("SELECT * FROM users WHERE email = ?", (DEMO_EMAIL,))
        self.assertIsNotNone(user)
        self.assertTrue(verify_password(DEMO_PASSWORD, user["password_hash"]))

    def test_tickets_seeded(self) -> None:
        tickets = rows("SELECT * FROM tickets")
        self.assertGreaterEqual(len(tickets), 4)

    def test_agent_login_and_overview(self) -> None:
        res = self.client.post("/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
        self.assertEqual(res.status_code, 200)
        token = res.json()["token"]
        overview = self.client.get("/overview", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(overview.status_code, 200)
        self.assertGreaterEqual(overview.json()["open"], 1)

    def test_requester_sees_only_own_tickets(self) -> None:
        res = self.client.post(
            "/auth/login",
            json={"email": "amira.khan@northgate.example", "password": "Request-Demo-2026"},
        )
        self.assertEqual(res.status_code, 200)
        token = res.json()["token"]
        tickets = self.client.get("/tickets", headers={"Authorization": f"Bearer {token}"}).json()["tickets"]
        self.assertTrue(all(t["requester"]["email"] == "amira.khan@northgate.example" for t in tickets))
        sam = row("SELECT id FROM tickets WHERE requester_id = 3")
        denied = self.client.get(f"/tickets/{sam['id']}", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
