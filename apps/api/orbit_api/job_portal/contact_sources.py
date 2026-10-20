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


def search_provider() -> str | None:
    settings = get_settings()
    if settings.contact_searxng_url:
        return "searxng"
    return "brave" if settings.contact_search_key else None


async def search_sources(company: str, title: str) -> list[Source]:
    settings = get_settings()
    provider = search_provider()
    if provider is None:
        return []
    # Operator-configured service, no redirects or environment proxy. Only company and role become query inputs.
    query = re.sub(r'[^\w .&-]', ' ', company)[:160] + " " + re.sub(r'[^\w -]', ' ', title)[:100]
    query += ' (recruiter OR "talent acquisition" OR "hiring manager")'
    headers = {"Accept": "application/json"}
    if provider == "searxng":
        url = str(settings.contact_searxng_url) + "/search"
        params: dict[str, str | int] = {"q": query, "format": "json", "categories": "general", "pageno": 1}
    else:
        assert settings.contact_search_key is not None
        url = "https://api.search.brave.com/res/v1/web/search"
        params = {"q": query, "count": 5, "text_decorations": "false"}
        headers["X-Subscription-Token"] = settings.contact_search_key.get_secret_value()
    async with asyncio.timeout(10), httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as client:
        async with client.stream("GET", url, params=params, headers=headers) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > 400000:
                    raise JobLinkError("Search returned too much data. Try a specific public company page.")
    data = json.loads(body)
    web = data if provider == "searxng" else data.get("web") if isinstance(data, dict) else None
    results = web.get("results", []) if isinstance(web, dict) else []
    sources: list[Source] = []
    for row in results[:5] if isinstance(results, list) else []:
        if not isinstance(row, dict):
            continue
        try:
            url = public_url(str(row.get("url", "")))
        except ValueError:
            continue
        text = html_to_text(str(row.get("title", "")) + "\n" +
                            str(row.get("content" if provider == "searxng" else "description", "")))[:1500]
        if not text.strip():
            continue
        sources.append(Source(id=f"web:{len(sources)}", kind="search_snippet", url=url, text=text))
    return sources
