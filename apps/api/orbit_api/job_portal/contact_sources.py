"""Bounded public contact research. Never logs in, guesses email addresses or accesses a mailbox."""
import asyncio
import json
import re
from datetime import UTC, datetime
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, Field

from orbit_api.config import get_settings
from orbit_api.prep.job_link import JobLinkError, fetch_reference_page, html_to_text
from orbit_api.runtime_config import get_effective_config


class Source(BaseModel):
    id: str
    kind: str
    url: str | None = None
    text: str = Field(max_length=10000)
    checked_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


def public_url(value: str) -> str:
    parts = urlsplit(value.strip())
    try:
        valid = (parts.scheme == "https" and parts.hostname and "." in parts.hostname
                 and bool(re.search(r"[a-z]", parts.hostname, re.I))
                 and not parts.hostname.endswith((".localhost", ".local", ".internal"))
                 and not parts.username and not parts.password and parts.port in (None, 443))
    except ValueError:
        valid = False
    if not valid or len(value) > 1000 or re.search(r"[\s\x00-\x1f]", value):
        raise ValueError("Use a public HTTPS source URL without credentials or a custom port.")
    return parts._replace(fragment="").geturl()


async def page_source(url: str) -> Source:
    page = await fetch_reference_page(public_url(url))
    return Source(id="page", kind="public_page", url=public_url(page.url), text=page.text[:10000])


def search_providers() -> list[str]:
    """Configured search services in the order tried: a run falls through to the next one when a service fails."""
    settings = get_settings()
    cfg = get_effective_config()
    out = []
    if settings.contact_searxng_url:
        out.append("searxng")
    if settings.contact_search_key:
        out.append("brave")
    if settings.contact_deepseek_search and cfg.deepseek_api_key and cfg.llm_provider != "mock":
        out.append("deepseek")
    return out


def search_provider() -> str | None:
    providers = search_providers()
    return providers[0] if providers else None


def search_off_reason() -> str | None:
    """Why automatic search is off, for the page to say exactly what to change. None when it's on."""
    if search_providers():
        return None
    settings = get_settings()
    cfg = get_effective_config()
    if not cfg.deepseek_api_key:
        return "no_key"
    if cfg.llm_provider == "mock":
        return "mock_mode"
    if not settings.contact_deepseek_search:
        return "deepseek_off"
    return "no_key"


SNIPPET_FIELD = {"deepseek": "snippet", "searxng": "content", "brave": "description"}
NAMES = {"searxng": "SearXNG", "brave": "Brave Search", "deepseek": "DeepSeek Search"}


def search_error(provider: str, exc: Exception) -> str:
    """A candidate-facing note for a failed search: never keys, balances or server setup. The specific cause is logged
    for the operator (contact_research logs provider and status)."""
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
        return "Live search is busy right now. Try again in a minute."
    if isinstance(exc, TimeoutError | httpx.TimeoutException):
        return "Live search took too long. Try again, or check a company page below."
    return "Live search isn't available right now. You can still check a company page or a recruiter's message."


def search_failure_detail(provider: str, exc: Exception) -> str:
    """The operator's view of a failed search, for the server log only."""
    name = NAMES.get(provider, provider)
    if isinstance(exc, httpx.HTTPStatusError):
        return f"{name} HTTP {exc.response.status_code}"
    return f"{name} {type(exc).__name__}"


def contact_queries(company: str, title: str) -> list[tuple[str, str]]:
    # Keep within the 128-character provider limit; no candidate profile data in public queries.
    employer = re.sub(r'[^\w .&-]', ' ', company).strip()[:60]
    role = re.sub(r'[^\w -]', ' ', title).strip()[:24]
    return [
        ("Hiring team", f'"{employer}" "{role}" "hiring manager"'),
        ("Recruiting", f'"{employer}" "{role}" (recruiter OR "talent acquisition")'),
        ("Professional profiles", f'site:linkedin.com/in "{employer}" (recruiter OR "{role}")'),
        ("Relevant team", f'"{employer}" "{role}" team contact'),
    ]


async def search_sources(company: str, title: str, *, query: str | None = None,
                         source_prefix: str = "web", provider: str | None = None) -> list[Source]:
    settings = get_settings()
    provider = provider or search_provider()
    if provider is None:
        return []
    # Operator-configured service, no redirects or environment proxy. Only company and role become query inputs.
    query = (query or contact_queries(company, title)[0][1])[:128]
    headers = {"Accept": "application/json"}
    params: dict[str, str | int] | None = None
    payload: dict[str, str | int | bool] | None = None
    if provider == "searxng":
        url = str(settings.contact_searxng_url) + "/search"
        params = {"q": query, "format": "json", "categories": "general", "pageno": 1}
    elif provider == "brave":
        assert settings.contact_search_key is not None
        url = "https://api.search.brave.com/res/v1/web/search"
        params = {"q": query, "count": 5, "text_decorations": "false"}
        headers["X-Subscription-Token"] = settings.contact_search_key.get_secret_value()
    else:
        key = get_effective_config().deepseek_api_key
        if not key:
            raise ValueError("DeepSeek search key is unavailable.")
        # Fixed endpoint: browser input and custom model base URLs cannot receive this secret.
        url = "https://api.deepseek.com/v1/tools/search"
        headers["Authorization"] = "Bearer " + key
        payload = {"query": query, "count": 5, "need_content": True}
    async with asyncio.timeout(10), httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
        async with client.stream("POST" if provider == "deepseek" else "GET", url, params=params,
                                 json=payload, headers=headers) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > 400000:
                    raise JobLinkError("Search returned too much data. Try a specific public company page.")
    data = json.loads(body)
    web = (data.get("web") if provider == "brave" else data) if isinstance(data, dict) else None
    results = web.get("results", []) if isinstance(web, dict) else []
    sources: list[Source] = []
    for row in results[:5] if isinstance(results, list) else []:
        if not isinstance(row, dict):
            continue
        try:
            url = public_url(str(row.get("url", "")))
        except ValueError:
            continue
        content = row.get("content") if provider == "deepseek" else None
        kind = "search_content" if isinstance(content, str) and content.strip() else "search_snippet"
        # Provider summaries are not literal published evidence: use returned content/snippet only.
        text = html_to_text(str(row.get("title", "")) + "\n" + str(content if kind == "search_content" else
            row.get(SNIPPET_FIELD.get(provider, "description"), "")))
        text = text[:3000 if kind == "search_content" else 1500]
        if not text.strip():
            continue
        sources.append(Source(id=f"{source_prefix}:{len(sources)}", kind=kind, url=url, text=text))
    return sources
