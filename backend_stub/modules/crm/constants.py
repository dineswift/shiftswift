"""CRM constants — pipeline stages, categories for IT/HR/B2B sales."""

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

DEAL_CATEGORIES: frozenset[str] = frozenset(
    {
        "general",
        "it_services",
        "hr_software",
        "consulting",
        "support_contract",
        "hospitality",
        "other",
    }
)

DEAL_CATEGORY_LABELS: dict[str, str] = {
    "general": "General",
    "it_services": "IT services & support",
    "hr_software": "HR software & platform",
    "consulting": "Consulting & professional services",
    "support_contract": "Support / SLA renewal",
    "hospitality": "Hospitality & events",
    "other": "Other",
}

ACCOUNT_TYPES: frozenset[str] = frozenset({"prospect", "customer", "partner"})

ACCOUNT_TYPE_LABELS: dict[str, str] = {
    "prospect": "Prospect",
    "customer": "Customer",
    "partner": "Partner",
}

ACTIVITY_TYPES = frozenset({"note", "call", "email", "meeting", "demo"})

ACTIVITY_TYPE_LABELS: dict[str, str] = {
    "note": "Note",
    "call": "Call",
    "email": "Email",
    "meeting": "Meeting",
    "demo": "Demo / presentation",
}

DEFAULT_EMAIL_TEMPLATES: tuple[dict[str, str], ...] = (
    {
        "template_key": "follow_up",
        "name": "Follow-up",
        "subject": "Following up — {{deal_title}}",
        "body_html": """<p>Hello {{contact_name}},</p>
<p>I wanted to follow up on {{deal_title}} for {{company_name}}.</p>
<p>{{custom_message}}</p>
<p>Please reply if you would like to discuss next steps.</p>
<p>Kind regards,<br>{{sender_name}}<br>{{business_name}}</p>""",
        "body_text": """Hello {{contact_name}},

I wanted to follow up on {{deal_title}} for {{company_name}}.

{{custom_message}}

Please reply if you would like to discuss next steps.

Kind regards,
{{sender_name}}
{{business_name}}""",
    },
    {
        "template_key": "proposal",
        "name": "Proposal sent",
        "subject": "Proposal — {{deal_title}}",
        "body_html": """<p>Hello {{contact_name}},</p>
<p>Thank you for your interest. Please find details regarding {{deal_title}} below.</p>
<p>{{custom_message}}</p>
<p>We look forward to hearing from you.</p>
<p>Kind regards,<br>{{sender_name}}<br>{{business_name}}</p>""",
        "body_text": """Hello {{contact_name}},

Thank you for your interest. Please find details regarding {{deal_title}} below.

{{custom_message}}

We look forward to hearing from you.

Kind regards,
{{sender_name}}
{{business_name}}""",
    },
    {
        "template_key": "thank_you",
        "name": "Thank you",
        "subject": "Thank you — {{company_name}}",
        "body_html": """<p>Hello {{contact_name}},</p>
<p>Thank you for your time today.</p>
<p>{{custom_message}}</p>
<p>Kind regards,<br>{{sender_name}}<br>{{business_name}}</p>""",
        "body_text": """Hello {{contact_name}},

Thank you for your time today.

{{custom_message}}

Kind regards,
{{sender_name}}
{{business_name}}""",
    },
    {
        "template_key": "demo_follow_up",
        "name": "Demo follow-up (IT / software)",
        "subject": "Thanks for the demo — {{deal_title}}",
        "body_html": """<p>Hello {{contact_name}},</p>
<p>Thank you for your time on the demo for {{deal_title}}.</p>
<p>{{custom_message}}</p>
<p>If you have any technical questions or would like a tailored quote, please reply and we will come back to you promptly.</p>
<p>Kind regards,<br>{{sender_name}}<br>{{business_name}}</p>""",
        "body_text": """Hello {{contact_name}},

Thank you for your time on the demo for {{deal_title}}.

{{custom_message}}

If you have any technical questions or would like a tailored quote, please reply and we will come back to you promptly.

Kind regards,
{{sender_name}}
{{business_name}}""",
    },
    {
        "template_key": "support_renewal",
        "name": "Support renewal (IT / SLA)",
        "subject": "Support renewal — {{company_name}}",
        "body_html": """<p>Hello {{contact_name}},</p>
<p>Your support agreement with {{business_name}} is due for renewal.</p>
<p>{{custom_message}}</p>
<p>Please let us know if you would like to schedule a quick review call.</p>
<p>Kind regards,<br>{{sender_name}}<br>{{business_name}}</p>""",
        "body_text": """Hello {{contact_name}},

Your support agreement with {{business_name}} is due for renewal.

{{custom_message}}

Please let us know if you would like to schedule a quick review call.

Kind regards,
{{sender_name}}
{{business_name}}""",
    },
    {
        "template_key": "hr_services_intro",
        "name": "HR services introduction",
        "subject": "HR support for {{company_name}}",
        "body_html": """<p>Hello {{contact_name}},</p>
<p>I wanted to introduce how {{business_name}} can support your HR team — from employee records and compliance to payroll and rota.</p>
<p>{{custom_message}}</p>
<p>Would a short call be helpful to explore what you need?</p>
<p>Kind regards,<br>{{sender_name}}<br>{{business_name}}</p>""",
        "body_text": """Hello {{contact_name}},

I wanted to introduce how {{business_name}} can support your HR team — from employee records and compliance to payroll and rota.

{{custom_message}}

Would a short call be helpful to explore what you need?

Kind regards,
{{sender_name}}
{{business_name}}""",
    },
)

TEMPLATE_PLACEHOLDERS = (
    "contact_name",
    "company_name",
    "deal_title",
    "sender_name",
    "business_name",
    "custom_message",
)
