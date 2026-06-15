"""AI document assistant — Google Gemini Flash (default) with optional OpenAI fallback."""

from __future__ import annotations

import os
from typing import Any

import httpx

DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

HR_SYSTEM_PROMPT = """You are ShiftSwift HR's document drafting assistant for UK employers.
Write clear, professional HR process documents suitable for hospitality and multi-site businesses.
Use UK English spelling and reference UK employment law concepts at a high level only.
Do NOT provide legal advice — include a brief note that the employer must review with qualified HR/legal counsel.
Output markdown only, no code fences unless the user asks for a checklist table.
Keep responses practical and ready for an HR manager to customise."""


class AiConfigurationError(Exception):
    """AI provider is not configured."""


class AiProviderError(Exception):
    """Upstream AI provider returned an error."""


def ai_globally_enabled() -> bool:
    return os.getenv("AI_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}


def configured_provider() -> str | None:
    if not ai_globally_enabled():
        return None
    provider = os.getenv("AI_PROVIDER", "gemini").strip().lower()
    if provider == "openai" and os.getenv("OPENAI_API_KEY"):
        return "openai"
    if provider in {"gemini", "google"} and os.getenv("GEMINI_API_KEY"):
        return "gemini"
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    return None


def generate_hr_document(
    *,
    user_prompt: str,
    context: str | None = None,
    existing_draft: str | None = None,
) -> dict[str, str]:
    """Generate or refine HR document text using the configured provider."""
    provider = configured_provider()
    if not provider:
        raise AiConfigurationError(
            "AI assistant is not configured. Set AI_ENABLED=1 and GEMINI_API_KEY (recommended) or OPENAI_API_KEY."
        )

    parts = [user_prompt.strip()]
    if context:
        parts.append(f"\n\nBusiness context:\n{context.strip()}")
    if existing_draft:
        parts.append(f"\n\nCurrent draft to improve or extend:\n{existing_draft.strip()}")
    user_message = "\n".join(parts)

    if provider == "gemini":
        text = _gemini_generate(user_message)
        model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    else:
        text = _openai_generate(user_message)
        model = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)

    return {
        "content_markdown": text.strip(),
        "provider": provider,
        "model": model,
        "disclaimer": "AI-generated draft — review with qualified HR or legal counsel before use.",
    }


def _gemini_generate(user_message: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "systemInstruction": {"parts": [{"text": HR_SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_message}]}],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": int(os.getenv("AI_MAX_OUTPUT_TOKENS", "4096")),
        },
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(url, params={"key": api_key}, json=payload)
    if response.status_code >= 400:
        raise AiProviderError(f"Gemini API error ({response.status_code}): {response.text[:500]}")
    data = response.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AiProviderError(f"Unexpected Gemini response: {data}") from exc


def _openai_generate(user_message: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": HR_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.4,
        "max_tokens": int(os.getenv("AI_MAX_OUTPUT_TOKENS", "4096")),
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
    if response.status_code >= 400:
        raise AiProviderError(f"OpenAI API error ({response.status_code}): {response.text[:500]}")
    data = response.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AiProviderError(f"Unexpected OpenAI response: {data}") from exc


CRM_SYSTEM_PROMPT = """You are ShiftSwift's sales CRM assistant for UK businesses — IT services, HR software,
consulting, support contracts, and hospitality. Help managers follow up on B2B enquiries and client opportunities.
Use UK English. Be concise and professional. Do not invent facts not provided in the context.
Do not provide legal advice. Output plain text unless asked for an email draft."""


def generate_crm_text(*, user_prompt: str, context: str | None = None) -> dict[str, str]:
    """Generate CRM summaries or email drafts using the configured AI provider."""
    provider = configured_provider()
    if not provider:
        raise AiConfigurationError(
            "AI assistant is not configured. Set AI_ENABLED=1 and GEMINI_API_KEY (recommended) or OPENAI_API_KEY."
        )

    parts = [user_prompt.strip()]
    if context:
        parts.append(f"\n\nCRM context:\n{context.strip()}")
    user_message = "\n".join(parts)

    if provider == "gemini":
        text = _gemini_generate_crm(user_message)
        model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    else:
        text = _openai_generate_crm(user_message)
        model = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)

    return {
        "content": text.strip(),
        "provider": provider,
        "model": model,
        "disclaimer": "AI-generated — review before sending to customers.",
    }


def _gemini_generate_crm(user_message: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "systemInstruction": {"parts": [{"text": CRM_SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_message}]}],
        "generationConfig": {
            "temperature": 0.35,
            "maxOutputTokens": int(os.getenv("AI_MAX_OUTPUT_TOKENS", "2048")),
        },
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(url, params={"key": api_key}, json=payload)
    if response.status_code >= 400:
        raise AiProviderError(f"Gemini API error ({response.status_code}): {response.text[:500]}")
    data = response.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AiProviderError(f"Unexpected Gemini response: {data}") from exc


def _openai_generate_crm(user_message: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": CRM_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.35,
        "max_tokens": int(os.getenv("AI_MAX_OUTPUT_TOKENS", "2048")),
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
    if response.status_code >= 400:
        raise AiProviderError(f"OpenAI API error ({response.status_code}): {response.text[:500]}")
    data = response.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AiProviderError(f"Unexpected OpenAI response: {data}") from exc
