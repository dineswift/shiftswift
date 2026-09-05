"""ShiftSwift HR — production brand, domain, and contact defaults."""

from __future__ import annotations

import os

APP_NAME = "ShiftSwift HR"
COMPANY_LEGAL_NAME = os.getenv("PROVIDER_LEGAL_NAME", "Datasoftware Analytics Ltd")
COMPANY_NUMBER = os.getenv("PROVIDER_COMPANY_NUMBER", "14568900")
REGISTERED_ADDRESS = os.getenv(
    "PROVIDER_ADDRESS",
    "235 Charlbury Road, Nottingham, NG8 1NF",
)
TRADING_NAME = APP_NAME
LEGAL_NOTICE = (
    f"{TRADING_NAME} is a trading name of {COMPANY_LEGAL_NAME} "
    f"(Company No. {COMPANY_NUMBER}), registered in England and Wales."
)
APP_DOMAIN = os.getenv("APP_DOMAIN", "shiftswifthr.co.uk")

MARKETING_URL = os.getenv("MARKETING_URL", f"https://www.{APP_DOMAIN}")
APP_URL = os.getenv("APP_URL", f"https://app.{APP_DOMAIN}")
API_URL = os.getenv("API_URL", f"https://api.{APP_DOMAIN}")

EMAIL_SUPPORT = os.getenv("EMAIL_SUPPORT", f"support@{APP_DOMAIN}")
EMAIL_HELLO = os.getenv("EMAIL_HELLO", EMAIL_SUPPORT)
EMAIL_LEGAL = os.getenv("EMAIL_LEGAL", f"legal@{APP_DOMAIN}")
EMAIL_NOREPLY = os.getenv("EMAIL_NOREPLY", f"noreply@{APP_DOMAIN}")
EMAIL_COMPLIANCE = os.getenv("EMAIL_COMPLIANCE", f"compliance@{APP_DOMAIN}")
EMAIL_ADMIN = os.getenv("EMAIL_ADMIN", f"admin@{APP_DOMAIN}")
EMAIL_HR = os.getenv("EMAIL_HR", f"hr@{APP_DOMAIN}")
EMAIL_EMPLOYEE = os.getenv("EMAIL_EMPLOYEE", f"employee@{APP_DOMAIN}")
EMAIL_SIGNUP_NOTIFY = os.getenv("EMAIL_SIGNUP_NOTIFY", "info@datasoftanalytics.com")

LOCAL_API_URL = os.getenv("LOCAL_API_URL", "http://localhost:3000")
LOCAL_APP_URL = os.getenv("LOCAL_APP_URL", "http://localhost:5173")

TAGLINE = "UK HR & sponsor licence compliance software"


def brand_payload(*, app_env: str = "development") -> dict[str, object]:
    is_dev = app_env.lower() not in {"production", "prod"}
    return {
        "app_name": APP_NAME,
        "trading_name": TRADING_NAME,
        "company_legal_name": COMPANY_LEGAL_NAME,
        "company_number": COMPANY_NUMBER,
        "registered_address": REGISTERED_ADDRESS,
        "legal_notice": LEGAL_NOTICE,
        "domain": APP_DOMAIN,
        "tagline": TAGLINE,
        "urls": {
            "marketing": MARKETING_URL,
            "app": APP_URL if not is_dev else LOCAL_APP_URL,
            "api": API_URL if not is_dev else LOCAL_API_URL,
        },
        "emails": {
            "hello": EMAIL_HELLO,
            "support": EMAIL_SUPPORT,
            "legal": EMAIL_LEGAL,
            "noreply": EMAIL_NOREPLY,
            "compliance": EMAIL_COMPLIANCE,
            "admin": EMAIL_ADMIN,
            "hr": EMAIL_HR,
            "employee": EMAIL_EMPLOYEE,
            "signup_notify": EMAIL_SIGNUP_NOTIFY,
        },
    }
