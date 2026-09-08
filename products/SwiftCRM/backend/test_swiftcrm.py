"""SwiftCRM unit tests — phones, caller ID, rent, hashed login."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

TMP = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["SWIFTCRM_DB"] = TMP.name
TMP.close()

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from data import DEMO_EMAIL, DEMO_PASSWORD, init_db, row, rows, verify_password  # noqa: E402
from phones import to_e164  # noqa: E402
from telephony import create_inbound_call, match_contact  # noqa: E402


class PhoneTests(unittest.TestCase):
    def test_uk_mobile(self) -> None:
        self.assertEqual(to_e164("07700 900111"), "+447700900111")

    def test_uk_landline(self) -> None:
        self.assertEqual(to_e164("0115 000 1000"), "+441150001000")

    def test_already_e164(self) -> None:
        self.assertEqual(to_e164("+447700900111"), "+447700900111")


class SeedAndCallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        init_db()

    def test_hashed_agency_user(self) -> None:
        user = row("SELECT * FROM users WHERE email = ?", (DEMO_EMAIL,))
        self.assertIsNotNone(user)
        self.assertTrue(verify_password(DEMO_PASSWORD, user["password_hash"]))

    def test_joint_tenant_seeded(self) -> None:
        elise = row("SELECT * FROM contacts WHERE email = ?", ("elise.ward@example.com",))
        self.assertIsNotNone(elise)
        link = row(
            "SELECT * FROM tenancy_occupiers WHERE contact_id = ? AND tenancy_id = 2",
            (elise["id"],),
        )
        self.assertIsNotNone(link)

    def test_hannah_caller_id(self) -> None:
        person = match_contact("07700 900111")
        self.assertIsNotNone(person)
        self.assertEqual(person["name"], "Hannah Reid")

    def test_inbound_screen_pop(self) -> None:
        pop = create_inbound_call("07700 900111")
        self.assertTrue(pop["matched"])
        self.assertEqual(pop["contact"]["name"], "Hannah Reid")
        self.assertEqual(pop["call"]["status"], "ringing")
        self.assertIsNotNone(pop["letting"])
        self.assertEqual(pop["letting"]["property_name"], "Mapperley Park garden flat")

    def test_new_ring_ends_previous_live_call(self) -> None:
        first = create_inbound_call("07700 900111")
        from data import execute, row

        execute("UPDATE calls SET status = 'answered' WHERE id = ?", (first["call"]["id"],))
        second = create_inbound_call("07700 900113")
        self.assertEqual(second["contact"]["name"], "Luca Bianchi")
        self.assertEqual(second["call"]["status"], "ringing")
        previous = row("SELECT status FROM calls WHERE id = ?", (first["call"]["id"],))
        self.assertEqual(previous["status"], "ended")

    def test_unknown_caller(self) -> None:
        pop = create_inbound_call("07700 900999")
        self.assertFalse(pop["matched"])
        self.assertIsNone(pop["contact"])

    def test_jobs_seeded(self) -> None:
        jobs = rows("SELECT * FROM jobs")
        self.assertGreaterEqual(len(jobs), 2)


if __name__ == "__main__":
    unittest.main()
