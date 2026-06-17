"""Branded HTML + plain-text email templates for ShiftSwift HR."""

from __future__ import annotations

import html
import os
from dataclasses import dataclass
from typing import Iterable

APP_NAME = os.getenv("APP_NAME", "ShiftSwift HR")
APP_DOMAIN = os.getenv("APP_DOMAIN", "shiftswifthr.co.uk")
APP_URL = os.getenv("APP_URL", f"https://app.{APP_DOMAIN}").rstrip("/")
MARKETING_URL = os.getenv("MARKETING_URL", f"https://www.{APP_DOMAIN}").rstrip("/")
SUPPORT_EMAIL = os.getenv("EMAIL_SUPPORT", f"support@{APP_DOMAIN}")
LEGAL_EMAIL = os.getenv("EMAIL_LEGAL", f"legal@{APP_DOMAIN}")
COMPLIANCE_EMAIL = os.getenv("EMAIL_COMPLIANCE", f"compliance@{APP_DOMAIN}")
LOGO_URL = os.getenv(
    "EMAIL_LOGO_URL",
    f"{APP_URL}/assets/shiftswift-hr-logo.png",
)

# Brand kit colours (inline for email clients)
GREEN_900 = "#04342c"
GREEN_800 = "#085041"
GREEN_700 = "#0f6e56"
GREEN_500 = "#1d9e75"
GREEN_100 = "#e1f5ee"
PAGE_BG = "#f5f4f0"
INK = "#111111"
MUTED = "#5f5e5a"
BORDER = "#d3d1c7"


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str
    html: str


def _esc(value: object) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _paragraphs(text_blocks: Iterable[str]) -> str:
    return "".join(
        f'<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{INK};">{_esc(block)}</p>'
        for block in text_blocks
    )


def _bullet_list(items: Iterable[tuple[str, str]]) -> str:
    rows = []
    for label, value in items:
        rows.append(
            f'<tr>'
            f'<td style="padding:8px 0;color:{MUTED};font-size:14px;width:120px;vertical-align:top;">{_esc(label)}</td>'
            f'<td style="padding:8px 0;color:{INK};font-size:14px;font-weight:600;">{_esc(value)}</td>'
            f"</tr>"
        )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:0 0 20px;background:{GREEN_100};border-radius:12px;padding:4px 16px;">'
        f"{''.join(rows)}</table>"
    )


def _cta_button(url: str, label: str) -> str:
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">'
        f"<tr><td>"
        f'<a href="{_esc(url)}" style="display:inline-block;background:{GREEN_700};color:#ffffff;'
        f"text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:10px;"
        f'font-family:Segoe UI,Helvetica,Arial,sans-serif;">{_esc(label)}</a>'
        f"</td></tr></table>"
    )


def render_email(
    *,
    preheader: str,
    title: str,
    intro: str,
    paragraphs: Iterable[str] = (),
    details: Iterable[tuple[str, str]] = (),
    cta_url: str | None = None,
    cta_label: str | None = None,
    footer_note: str | None = None,
) -> str:
    """Wrap content in a responsive, client-safe HTML shell."""
    preheader_esc = _esc(preheader)
    detail_html = _bullet_list(details) if details else ""
    cta_html = _cta_button(cta_url, cta_label) if cta_url and cta_label else ""
    footer = footer_note or f"Questions? Reply to {_esc(SUPPORT_EMAIL)}"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>{_esc(title)}</title>
  <style>
    @media only screen and (max-width: 620px) {{
      .shell {{ width: 100% !important; }}
      .pad {{ padding-left: 20px !important; padding-right: 20px !important; }}
    }}
  </style>
</head>
<body style="margin:0;padding:0;background:{PAGE_BG};font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{preheader_esc}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE_BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0"
          style="max-width:600px;width:100%;background:#ffffff;border:1px solid {BORDER};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,{GREEN_800},{GREEN_700});padding:24px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="{_esc(LOGO_URL)}" alt="{_esc(APP_NAME)}" width="160"
                      style="display:block;max-width:160px;height:auto;border:0;" />
                  </td>
                  <td align="right" style="vertical-align:middle;color:#ffffff;font-size:12px;opacity:0.9;">
                    UK HR &amp; compliance
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:32px 28px 12px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:{GREEN_900};">{_esc(title)}</h1>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{INK};">{_esc(intro)}</p>
              {_paragraphs(paragraphs)}
              {detail_html}
              {cta_html}
            </td>
          </tr>
          <tr>
            <td class="pad" style="padding:8px 28px 28px;">
              <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:{MUTED};">{_esc(footer)}</p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:{MUTED};">
                {_esc(APP_NAME)} · {_esc(APP_DOMAIN)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def welcome_trial_email(
    *,
    business_name: str,
    billing_email: str,
    plan_name: str,
    trial_days: int,
    admin_url: str | None = None,
) -> EmailContent:
    login_url = f"{APP_URL}/business-login.html"
    dashboard_url = admin_url or f"{APP_URL}/admin.html"
    subject = f"Welcome to {APP_NAME} — your {trial_days}-day trial is active"
    text = (
        f"Hello,\n\n"
        f"Your {APP_NAME} workspace for {business_name} is ready.\n\n"
        f"What you can use now:\n"
        f"- Employee records and HR lifecycle\n"
        f"- Document store and payslip sharing tools\n"
        f"- Rota publishing and employee portal invites\n"
        f"- Sponsor compliance alerts and audit exports (if enabled on your plan)\n"
        f"- Geofenced time clock for staff\n\n"
        f"Sign in: {login_url}\n"
        f"Username: {billing_email}\n"
        f"Password: use the password you chose when signing up (not sent by email for security)\n"
        f"Plan: {plan_name}\n"
        f"Trial: {trial_days} days\n\n"
        f"Open your admin dashboard: {dashboard_url}\n\n"
        f"We will send a separate getting-started guide for the HR admin portal, employee portal, "
        f"and time clock app, plus your Master Services Agreement for electronic signature. "
        f"ShiftSwift HR is software only — your organisation remains responsible for HR, "
        f"payroll, immigration, and sponsor licence compliance decisions.\n\n"
        f"Need help? {SUPPORT_EMAIL}\n\n"
        f"{APP_NAME}\n"
    )
    html = render_email(
        preheader=f"Your {trial_days}-day trial for {business_name} is ready.",
        title=f"Your {trial_days}-day trial is active",
        intro=f"Your {APP_NAME} workspace for {business_name} is ready. Sign in to set up HR, compliance, and your team.",
        paragraphs=[
            "You can now use employee records, documents, rota tools, employee portal invites, compliance alerts, and the time clock (by plan).",
            "We will send a separate getting-started guide and your Master Services Agreement for electronic signature. ShiftSwift HR provides software tools and alerts only — your organisation remains responsible for HR, payroll, immigration, and sponsor licence compliance.",
        ],
        details=[
            ("Username", billing_email),
            ("Password", "Use the password you chose at sign-up"),
            ("Plan", plan_name),
            ("Trial", f"{trial_days} days"),
        ],
        cta_url=dashboard_url,
        cta_label="Open HR dashboard",
    )
    return EmailContent(subject=subject, text=text, html=html)


def signup_platform_guide_email(
    *,
    business_name: str,
    billing_email: str,
) -> EmailContent:
    login_url = f"{APP_URL}/business-login.html"
    admin_url = f"{APP_URL}/admin.html"
    employee_portal_url = f"{APP_URL}/employee-login.html"
    time_clock_url = f"{APP_URL}/employee.html#time-clock"
    subject = f"{APP_NAME} — how to use your HR platform, employee portal & time clock"
    text = (
        f"Hello,\n\n"
        f"Your {APP_NAME} workspace for {business_name} is a software platform to help you "
        f"manage employee details, documents, rotas, and compliance records.\n\n"
        f"IMPORTANT — WHAT SHIFT SWIFT HR IS NOT\n"
        f"{APP_NAME} is not an outsourced HR advisory or HR outsourcing service. We do not "
        f"provide HR consultants, perform Right to Work checks for you, or act as your HR department. "
        f"If you need a full HR service from ShiftSwift HR, that is not available yet and would "
        f"require different sign-up procedures when offered.\n\n"
        f"HR ADMIN PORTAL (YOU)\n"
        f"1. Sign in at {login_url}\n"
        f"2. Username: {billing_email}\n"
        f"3. Open your dashboard: {admin_url}\n"
        f"4. Add employees under Employees, then send portal invites from the employee side panel\n\n"
        f"EMPLOYEE PORTAL (YOUR STAFF)\n"
        f"1. You send a portal invite from Employees in the HR admin dashboard\n"
        f"2. The employee opens the email link and sets a password\n"
        f"3. They sign in at {employee_portal_url}\n"
        f"4. Portal home: {APP_URL}/employee.html — clock in on the Clock tab\n"
        f"5. Staff can view payslips, documents, and published rotas\n"
        f"6. Ask staff to check junk/spam if the invite email is missing\n\n"
        f"TIME CLOCK (CLOCK IN / OUT)\n"
        f"1. Staff sign in at {employee_portal_url} and open the Clock tab\n"
        f"2. Install the employee app to the home screen when prompted (Add to Home Screen on iPhone)\n"
        f"3. Allow location access — clock in/out works at assigned work sites only\n\n"
        f"SUPPORT\n"
        f"General help & onboarding: {SUPPORT_EMAIL}\n"
        f"Legal & contracts: {LEGAL_EMAIL}\n"
        f"Sponsor compliance software questions: {COMPLIANCE_EMAIL}\n\n"
        f"Website: {MARKETING_URL}\n\n"
        f"{APP_NAME}\n"
        f"{APP_NAME} is a trading name of Datasoftware Analytics Ltd.\n"
    )
    html = render_email(
        preheader="How to use HR admin, the employee portal, and the time clock app.",
        title="Getting started with your platform",
        intro=(
            f"Your {APP_NAME} workspace for {business_name} is a software platform to manage "
            f"employee details, documents, rotas, and compliance records — not an outsourced HR service."
        ),
        paragraphs=[
            (
                f"{APP_NAME} does not provide HR consultants, outsourced HR, or immigration advice. "
                f"Your organisation remains responsible for HR decisions and compliance. "
                f"A separate full HR service from ShiftSwift HR is not offered yet and would use "
                f"different sign-up procedures when available."
            ),
            f"HR admin sign-in: {login_url} → username {billing_email} → dashboard {admin_url}. Add employees, then send portal invites from Employees.",
            f"Employee portal: invite staff from Employees → they set a password from the email → sign in at {employee_portal_url} → clock in on the Clock tab at {time_clock_url}.",
            "Staff can install the employee app to their home screen from the portal banner for quick access.",
        ],
        details=[
            ("Support", SUPPORT_EMAIL),
            ("Legal & contracts", LEGAL_EMAIL),
            ("Compliance software", COMPLIANCE_EMAIL),
        ],
        cta_url=admin_url,
        cta_label="Open HR admin dashboard",
    )
    return EmailContent(subject=subject, text=text, html=html)


def password_reset_email(*, role_label: str, reset_url: str, reset_hours: int) -> EmailContent:
    subject = f"{APP_NAME} — reset your password"
    text = (
        f"Hello,\n\n"
        f"We received a request to reset the password for your {APP_NAME} {role_label} account.\n\n"
        f"Open this link to choose a new password (expires in {reset_hours} hours):\n"
        f"{reset_url}\n\n"
        f"If you did not request this, you can ignore this email.\n\n"
        f"{APP_NAME}\n"
        f"Reply: {SUPPORT_EMAIL}\n"
    )
    html = render_email(
        preheader="Reset your ShiftSwift HR password.",
        title="Reset your password",
        intro=f"We received a request to reset the password for your {role_label} account.",
        paragraphs=[
            f"This link expires in {reset_hours} hours. If you did not request a reset, you can ignore this email.",
        ],
        cta_url=reset_url,
        cta_label="Choose a new password",
    )
    return EmailContent(subject=subject, text=text, html=html)


def contract_signing_email(
    *,
    signatory_name: str | None,
    contract_name: str,
    contract_number: str,
    signing_url: str,
) -> EmailContent:
    greeting = signatory_name or "there"
    subject = f"{APP_NAME} — Please sign {contract_name} ({contract_number})"
    text = (
        f"Dear {greeting},\n\n"
        f"Please review and sign your ShiftSwift HR legal agreement:\n{signing_url}\n\n"
        f"This link expires in 30 days.\n\n{APP_NAME}\n"
    )
    html = render_email(
        preheader=f"Sign your {contract_name}.",
        title="Please review and sign",
        intro=f"Dear {greeting}, your {contract_name} ({contract_number}) is ready for electronic signature.",
        paragraphs=["This secure link expires in 30 days."],
        cta_url=signing_url,
        cta_label="Review and sign",
    )
    return EmailContent(subject=subject, text=text, html=html)


def trial_reminder_email(
    *,
    tenant_name: str,
    days_left: int | None,
    trial_end_label: str,
    reminder_key: str,
    upgrade_url: str,
) -> EmailContent:
    if reminder_key == "expired":
        subject = f"{APP_NAME} — your free trial has ended"
        intro = f"Your 14-day trial for {tenant_name} ended on {trial_end_label}."
        preheader = "Upgrade to keep access to ShiftSwift HR."
        paragraphs = [
            "Upgrade now to keep HR records, sponsor compliance alerts, templates, and payroll add-ons.",
        ]
        cta_label = "Upgrade your plan"
    else:
        day_word = "day" if days_left == 1 else "days"
        subject = f"{APP_NAME} — {days_left} {day_word} left on your free trial"
        intro = f"Your trial for {tenant_name} ends on {trial_end_label} ({days_left} {day_word} remaining)."
        preheader = f"{days_left} {day_word} left on your ShiftSwift HR trial."
        paragraphs = [
            "Upgrade before the trial ends to avoid interruption. All prices are shown ex VAT.",
        ]
        cta_label = "Upgrade before trial ends"

    text = f"Hello,\n\n{intro}\n\n{upgrade_url}\n\nQuestions? Reply to support@{APP_DOMAIN}\n\n— {APP_NAME}\n"
    html = render_email(
        preheader=preheader,
        title=subject.replace(f"{APP_NAME} — ", ""),
        intro=intro,
        paragraphs=paragraphs,
        cta_url=upgrade_url,
        cta_label=cta_label,
    )
    return EmailContent(subject=subject, text=text, html=html)


def compliance_alert_email(*, message: str) -> EmailContent:
    subject = f"{APP_NAME}: Compliance action required"
    text = f"{message}\n\n— {APP_NAME}\n"
    html = render_email(
        preheader="Compliance action required in ShiftSwift HR.",
        title="Compliance action required",
        intro=message,
        cta_url=f"{APP_URL}/admin.html#compliance",
        cta_label="Open compliance dashboard",
    )
    return EmailContent(subject=subject, text=text, html=html)


def payroll_hours_report_email(
    *,
    tenant_name: str,
    period_start: str,
    period_end: str,
    employee_count: int,
    total_hours: float,
    methodology: str,
) -> EmailContent:
    subject = f"{APP_NAME} — Working hours report for {tenant_name} ({period_start} to {period_end})"
    summary = (
        f"{employee_count} employee{'s' if employee_count != 1 else ''} with clock records · "
        f"{total_hours:.2f} total hours (complete punch pairs only)"
    )
    text = (
        f"Hello,\n\n"
        f"Please find attached the ShiftSwift HR working hours report for {tenant_name}.\n\n"
        f"Period: {period_start} to {period_end}\n"
        f"{summary}\n\n"
        f"How hours are calculated:\n{methodology}\n\n"
        f"ShiftSwift HR does not run payroll or calculate pay — use this report with your payroll software.\n\n"
        f"— {APP_NAME}\n"
    )
    html = render_email(
        preheader=f"Working hours for {period_start} to {period_end}.",
        title="Monthly working hours report",
        intro=f"Attached is the working hours report for <strong>{tenant_name}</strong>.",
        paragraphs=[
            f"Period: {period_start} to {period_end}",
            summary,
            f"<strong>How hours are calculated:</strong> {methodology}",
            "ShiftSwift HR does not run payroll or calculate pay — use this report with your payroll software or bureau.",
        ],
    )
    return EmailContent(subject=subject, text=text, html=html)


def employee_portal_invite_email(
    *,
    employee_name: str,
    notification_from_name: str,
    employer_legal_name: str,
    setup_url: str,
    login_url: str,
    reset_hours: int,
) -> EmailContent:
    subject = f"{APP_NAME} — Set up your employee portal"
    intro = f"{notification_from_name} has invited you to ShiftSwift HR's employee portal."
    privacy_url = f"{APP_URL}/privacy-policy.html"
    gdpr_note = (
        f"{employer_legal_name} is your employer and is responsible for managing your personal data, "
        f"workplace privacy notices, and UK GDPR obligations for your employment records. "
        f"ShiftSwift HR provides the software platform only. When you choose your password, "
        f"you will be asked to confirm you understand this and agree to the privacy notice."
    )
    text = (
        f"Hello {employee_name},\n\n"
        f"{intro}\n\n"
        f"{gdpr_note}\n\n"
        f"Choose a password using this secure link (expires in {reset_hours} hours):\n"
        f"{setup_url}\n\n"
        f"After that, sign in as an employee at:\n{login_url}\n"
        f"Use the same work email address this invite was sent to.\n"
        f"If you do not see this email, check your junk or spam folder.\n\n"
        f"Privacy policy: {privacy_url}\n\n"
        f"— {APP_NAME}\n"
    )
    html = render_email(
        preheader="Set up your employee portal access.",
        title="Welcome to your employee portal",
        intro=f"Hello {employee_name}, {intro}",
        paragraphs=[
            gdpr_note,
            f"This link expires in {reset_hours} hours. Choose a password, then sign in using your work email at {login_url}.",
            "If you do not see this email, check your junk or spam folder.",
            f"Portal sign-in: {login_url}",
            f'Privacy policy: <a href="{privacy_url}">{privacy_url}</a>',
        ],
        cta_url=setup_url,
        cta_label="Choose your password",
    )
    return EmailContent(subject=subject, text=text, html=html)


def portal_setup_pending_hr_email(
    *,
    tenant_name: str,
    pending_employees: list[dict[str, str]],
    admin_url: str,
) -> EmailContent:
    count = len(pending_employees)
    names_preview = ", ".join(item["name"] for item in pending_employees[:5])
    if count > 5:
        names_preview = f"{names_preview}, and {count - 5} more"
    subject = f"{APP_NAME} — {count} employee portal setup{'s' if count != 1 else ''} still pending"
    text = (
        f"Hello,\n\n"
        f"The following employee{'s' if count != 1 else ''} at {tenant_name} "
        f"{'have' if count != 1 else 'has'} not finished setting up their portal password yet:\n"
        f"{names_preview}\n\n"
        f"They may have missed the invite email — ask them to check junk or spam, "
        f"or resend the portal link from Employees in ShiftSwift HR:\n"
        f"{admin_url}\n\n"
        f"— {APP_NAME}\n"
    )
    html = render_email(
        preheader=f"{count} employee portal account{'s' if count != 1 else ''} still waiting for setup.",
        title="Employee portal setup still pending",
        intro=f"At {tenant_name}, {count} employee{'s' if count != 1 else ''} invited to the portal "
        f"{'have' if count != 1 else 'has'} not chosen a password yet.",
        paragraphs=[
            f"Waiting: {names_preview}.",
            "Ask them to check junk or spam for the invite email, or resend the setup link from Employees.",
            f"Open admin: {admin_url}",
        ],
        cta_url=admin_url,
        cta_label="Open Employees",
    )
    return EmailContent(subject=subject, text=text, html=html)


def employee_document_shared_email(
    *,
    employee_name: str,
    document_title: str,
    category_label: str,
    pay_period: str | None,
    tenant_name: str,
) -> EmailContent:
    period_line = f" for {pay_period}" if pay_period else ""
    subject = f"{APP_NAME} — New {category_label.lower()}{period_line}"
    portal_url = f"{APP_URL}/employee.html#documents"
    intro = f"{tenant_name} has shared a new document with you: {document_title}."
    details = [("Type", category_label)]
    if pay_period:
        details.append(("Pay period", pay_period))
    text = (
        f"Hello {employee_name},\n\n"
        f"{intro}\n\n"
        f"Sign in to your employee portal to view and download it:\n{portal_url}\n\n"
        f"— {APP_NAME}\n"
    )
    html = render_email(
        preheader=f"New {category_label.lower()} from {tenant_name}.",
        title="New document available",
        intro=f"Hello {employee_name}, {intro}",
        details=details,
        cta_url=portal_url,
        cta_label="Open employee portal",
    )
    return EmailContent(subject=subject, text=text, html=html)


def rota_published_email(
    *,
    employee_name: str,
    tenant_name: str,
    week_label: str,
    shift_lines: list[str],
) -> EmailContent:
    subject = f"{APP_NAME} — Your rota for {week_label}"
    portal_url = f"{APP_URL}/employee.html#rota"
    shift_text = "\n".join(f"• {line}" for line in shift_lines) if shift_lines else "See your employee portal for details."
    intro = f"{tenant_name} has published your shifts for {week_label}."
    text = (
        f"Hello {employee_name},\n\n"
        f"{intro}\n\n"
        f"{shift_text}\n\n"
        f"View your full rota:\n{portal_url}\n\n"
        f"— {APP_NAME}\n"
    )
    paragraphs = shift_lines[:8] if shift_lines else ["Open your employee portal to see your full schedule."]
    if len(shift_lines) > 8:
        paragraphs.append(f"…and {len(shift_lines) - 8} more shift(s) in the portal.")
    html = render_email(
        preheader=f"Your rota for {week_label} is ready.",
        title="Your rota is published",
        intro=f"Hello {employee_name}, {intro}",
        paragraphs=paragraphs,
        cta_url=portal_url,
        cta_label="View my rota",
    )
    return EmailContent(subject=subject, text=text, html=html)


def missed_punch_hr_email(
    *,
    tenant_name: str,
    employee_name: str,
    shift_label: str,
    role_label: str,
    grace_minutes: int,
) -> EmailContent:
    rota_url = f"{APP_URL}/admin.html#rota"
    role_bit = f" ({role_label})" if role_label else ""
    subject = f"{APP_NAME} — missed clock-in: {employee_name}"
    intro = (
        f"{employee_name} has not clocked in {grace_minutes} minutes after their scheduled shift start{role_bit}."
    )
    text = (
        f"Hello,\n\n"
        f"{intro}\n\n"
        f"Shift: {shift_label}\n"
        f"Organisation: {tenant_name}\n\n"
        f"Review attendance in the rota:\n{rota_url}\n\n"
        f"— {APP_NAME}\n"
    )
    html = render_email(
        preheader=f"No clock-in for {employee_name} ({shift_label}).",
        title="Missed clock-in alert",
        intro=intro,
        details=[
            ("Employee", employee_name),
            ("Shift", shift_label),
            ("Organisation", tenant_name),
        ],
        cta_url=rota_url,
        cta_label="Open rota attendance",
    )
    return EmailContent(subject=subject, text=text, html=html)


def missed_punch_employee_email(
    *,
    employee_name: str,
    tenant_name: str,
    shift_label: str,
    grace_minutes: int,
) -> EmailContent:
    clock_url = f"{APP_URL}/punch.html"
    subject = f"{APP_NAME} — please clock in for your shift"
    intro = (
        f"Your shift at {tenant_name} started at least {grace_minutes} minutes ago and we have not "
        f"received a clock-in yet."
    )
    text = (
        f"Hello {employee_name},\n\n"
        f"{intro}\n\n"
        f"Shift: {shift_label}\n\n"
        f"Open the Time Clock app and clock in when you are at your work site:\n{clock_url}\n\n"
        f"Location access is required at punch time.\n\n"
        f"— {APP_NAME}\n"
    )
    html = render_email(
        preheader=f"Please clock in for {shift_label}.",
        title="Clock in reminder",
        intro=f"Hello {employee_name}, {intro}",
        details=[("Shift", shift_label)],
        paragraphs=[
            "Open the Time Clock app on your phone and tap Clock in when you arrive at your assigned site.",
            "Allow location when prompted — you must be within your employer's geofence to punch.",
        ],
        cta_url=clock_url,
        cta_label="Open Time Clock",
    )
    return EmailContent(subject=subject, text=text, html=html)


def payment_failure_email(
    *,
    tenant_name: str,
    reminder_key: str,
    billing_url: str,
    grace_days_left: int | None = None,
    grace_period_days: int = 14,
) -> EmailContent:
    domain = APP_DOMAIN
    if reminder_key == "grace_start":
        subject = f"{APP_NAME} — payment failed"
        intro = f"We could not collect your subscription payment by Direct Debit for {tenant_name}."
        paragraphs = [
            f"You have {grace_period_days} days to resolve this before your software licence is placed on hold.",
            "Update your payment details or pay now using the button below.",
        ]
    elif reminder_key == "grace_mid":
        subject = f"{APP_NAME} — payment still overdue"
        intro = "Your Direct Debit payment for ShiftSwift HR is still outstanding."
        paragraphs = [
            f"Grace period remaining: {grace_days_left} day(s). After that, access will be restricted.",
        ]
    elif reminder_key == "grace_1_day":
        subject = f"{APP_NAME} — licence will be placed on hold tomorrow"
        intro = "This is your final reminder before your licence is placed on hold."
        paragraphs = ["Pay or update Direct Debit within 1 day to keep uninterrupted access."]
    else:
        subject = f"{APP_NAME} — software licence on hold"
        intro = f"Your licence is on hold because we have not received payment after the {grace_period_days}-day grace period."
        paragraphs = ["Admin access is restricted until payment succeeds."]

    text = f"Hello,\n\n{intro}\n\n{billing_url}\n\nSupport: support@{domain}\n\n— {APP_NAME}\n"
    html = render_email(
        preheader=subject,
        title=subject.replace(f"{APP_NAME} — ", ""),
        intro=intro,
        paragraphs=paragraphs,
        cta_url=billing_url,
        cta_label="Resolve payment",
    )
    return EmailContent(subject=subject, text=text, html=html)


def generic_notification_email(*, subject: str, message: str, cta_url: str | None = None, cta_label: str | None = None) -> EmailContent:
    """Fallback HTML wrapper for legacy plain-text notifications."""
    text = f"{message}\n\n— {APP_NAME}\n"
    html = render_email(
        preheader=subject,
        title=subject,
        intro=message,
        cta_url=cta_url,
        cta_label=cta_label,
    )
    return EmailContent(subject=subject, text=text, html=html)
