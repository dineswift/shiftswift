"""Export HR template markdown as PDF or Word (.doc HTML)."""

from __future__ import annotations

import html
import io
import re
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer


def _markdown_to_html(markdown: str) -> str:
    """Minimal markdown → HTML for Word export."""
    lines = markdown.splitlines()
    out: list[str] = []
    in_ul = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("### "):
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append(f"<h3>{html.escape(stripped[4:])}</h3>")
        elif stripped.startswith("## "):
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append(f"<h2>{html.escape(stripped[3:])}</h2>")
        elif stripped.startswith("# "):
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append(f"<h1>{html.escape(stripped[2:])}</h1>")
        elif stripped.startswith("- [ ] ") or stripped.startswith("- [x] "):
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            text = stripped[6:]
            out.append(f"<li>{html.escape(text)}</li>")
        elif stripped.startswith("- "):
            if not in_ul:
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{html.escape(stripped[2:])}</li>")
        elif stripped.startswith("|") and "---" in stripped:
            continue
        elif stripped.startswith("|"):
            cells = [html.escape(c.strip()) for c in stripped.strip("|").split("|")]
            out.append(f"<p>{' · '.join(cells)}</p>")
        elif stripped == "---":
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append("<hr />")
        elif not stripped:
            if in_ul:
                out.append("</ul>")
                in_ul = False
            out.append("<br />")
        else:
            if in_ul:
                out.append("</ul>")
                in_ul = False
            text = html.escape(stripped)
            text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
            out.append(f"<p>{text}</p>")
    if in_ul:
        out.append("</ul>")
    return "\n".join(out)


def _inline_markup(text: str) -> str:
    escaped = html.escape(text)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"\*(.+?)\*", r"<i>\1</i>", escaped)
    return escaped


def _markdown_to_pdf_flowables(markdown: str) -> list:
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle(
        "TemplateH1",
        parent=styles["Heading1"],
        fontSize=16,
        spaceAfter=8,
        textColor=colors.HexColor("#0F6E56"),
    )
    h2 = ParagraphStyle(
        "TemplateH2",
        parent=styles["Heading2"],
        fontSize=13,
        spaceBefore=10,
        spaceAfter=6,
        textColor=colors.HexColor("#1E293B"),
    )
    h3 = ParagraphStyle(
        "TemplateH3",
        parent=styles["Heading3"],
        fontSize=11,
        spaceBefore=8,
        spaceAfter=4,
        textColor=colors.HexColor("#334155"),
    )
    body = ParagraphStyle("TemplateBody", parent=styles["Normal"], fontSize=10, leading=14)
    meta = ParagraphStyle("TemplateMeta", parent=styles["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#64748B"))
    italic = ParagraphStyle("TemplateItalic", parent=body, fontName="Helvetica-Oblique")

    flowables: list = []
    bullet_items: list[str] = []

    def flush_bullets() -> None:
        nonlocal bullet_items
        if not bullet_items:
            return
        items = [ListItem(Paragraph(_inline_markup(item), body), leftIndent=12) for item in bullet_items]
        flowables.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=18))
        bullet_items = []

    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            flush_bullets()
            flowables.append(Paragraph(_inline_markup(stripped[2:]), h1))
        elif stripped.startswith("## "):
            flush_bullets()
            flowables.append(Paragraph(_inline_markup(stripped[3:]), h2))
        elif stripped.startswith("### "):
            flush_bullets()
            flowables.append(Paragraph(_inline_markup(stripped[4:]), h3))
        elif stripped.startswith("- "):
            bullet_items.append(stripped[2:])
        elif stripped.startswith("- [ ] ") or stripped.startswith("- [x] "):
            prefix = "☐ " if stripped.startswith("- [ ] ") else "☑ "
            text = stripped[6:]
            bullet_items.append(prefix + text)
        elif stripped.startswith("|") and "---" in stripped:
            continue
        elif stripped.startswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            flush_bullets()
            flowables.append(Paragraph(_inline_markup(" · ".join(cells)), body))
        elif stripped == "---":
            flush_bullets()
            flowables.append(Spacer(1, 6))
        elif not stripped:
            flush_bullets()
            flowables.append(Spacer(1, 4))
        else:
            flush_bullets()
            if stripped.startswith("_") and stripped.endswith("_"):
                flowables.append(Paragraph(_inline_markup(stripped.strip("_")), italic))
            else:
                flowables.append(Paragraph(_inline_markup(stripped), body))

    flush_bullets()
    return flowables


def build_template_pdf_bytes(markdown: str, *, title: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    footer_style = ParagraphStyle(
        "TemplateFooter",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#94A3B8"),
    )
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    body: list = [
        Paragraph(
            f"<i>Generated by ShiftSwift HR (shiftswifthr.co.uk) · {generated}</i>",
            footer_style,
        ),
        Spacer(1, 8),
    ]
    body.extend(_markdown_to_pdf_flowables(markdown))
    doc.build(body)
    return buffer.getvalue()


def build_template_word_bytes(markdown: str, *, title: str) -> bytes:
    html_body = _markdown_to_html(markdown)
    safe_title = html.escape(title)
    document = f"""<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8">
<title>{safe_title}</title>
<style>
body {{ font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.45; margin: 2cm; color: #1e293b; }}
h1 {{ font-size: 18pt; color: #0f6e56; margin-bottom: 12pt; }}
h2 {{ font-size: 14pt; margin-top: 14pt; margin-bottom: 6pt; }}
h3 {{ font-size: 12pt; margin-top: 10pt; margin-bottom: 4pt; }}
p {{ margin: 0 0 8pt; }}
ul {{ margin: 0 0 8pt 18pt; }}
hr {{ border: none; border-top: 1px solid #cbd5e1; margin: 12pt 0; }}
</style>
</head>
<body>{html_body}</body>
</html>"""
    return document.encode("utf-8")
