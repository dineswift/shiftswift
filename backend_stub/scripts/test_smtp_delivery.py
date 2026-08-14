#!/usr/bin/env python3
"""Test SMTP from this server (run on production API host after sourcing .env)."""

from __future__ import annotations

import os
import smtplib
import sys
import urllib.request


def main() -> int:
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587") or "587")
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    from_addr = os.getenv("SMTP_FROM", "").strip()
    use_tls = os.getenv("SMTP_USE_TLS", "1").strip().lower() in {"1", "true", "yes"}

    try:
        outbound = urllib.request.urlopen("https://api.ipify.org", timeout=15).read().decode().strip()
    except Exception as exc:
        outbound = f"(could not detect: {exc})"

    print("=== ShiftSwift SMTP diagnostic ===")
    print(f"Outbound public IP: {outbound}")
    print(f"SMTP_HOST:         {host or '(not set)'}")
    print(f"SMTP_PORT:         {port}")
    print(f"SMTP_USER:         {user or '(not set)'}")
    print(f"SMTP_FROM:         {from_addr or '(not set)'}")
    print(f"SMTP_USE_TLS:      {use_tls}")
    print(f"Password set:      {'yes' if password else 'no'}")

    if not all([host, user, password, from_addr]):
        print("\nFAIL: Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM in backend_stub/.env")
        return 1

    if host != "smtp-relay.brevo.com" and "brevo" not in host and "sendinblue" not in host:
        print("\nWARN: SMTP_HOST is not Brevo (smtp-relay.brevo.com).")
        print("      525 Unauthorized IP often comes from Hostinger/cPanel mail, not Brevo.")

    print("\nConnecting…")
    try:
        with smtplib.SMTP(host, port, timeout=30) as server:
            if use_tls:
                server.starttls()
            server.login(user, password)
            print("OK: SMTP login succeeded.")
            print(f"    Authorize this IP in Brevo if blocking is on: {outbound}")
    except Exception as exc:
        print(f"FAIL: {exc}")
        print(f"\nIf this is 525 Unauthorized IP:")
        print(f"  1. Brevo → Security → Authorized IPs → add {outbound}")
        print(f"  2. Remove that IP from Unauthorized tab if listed")
        print(f"  3. Or set SMTP_HOST=smtp-relay.brevo.com (not Hostinger mail)")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
