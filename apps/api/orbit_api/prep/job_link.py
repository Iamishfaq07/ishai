"""Import a job posting from a link (for Prep), without letting the link reach anything it shouldn't.

Fetching a user-supplied URL server-side is an SSRF risk, so:
- http(s) only, default ports only, no credentials in the URL;
- the host is resolved once and every address must be public (`is_global`) — no loopback, private, link-local
  (cloud metadata), CGNAT or reserved ranges;
- the connection goes to that checked IP (Host header + TLS SNI carry the name, so certificates still verify), so a
  second DNS answer can't swap in an internal address (DNS rebinding);
- redirects are followed by hand, re-checking every hop, at most MAX_REDIRECTS;
- a short timeout, a size cap, HTML/plain text only, and no proxy from the environment.

The text comes from the page's schema.org JobPosting data when present (Greenhouse, Lever, Workday, most ATSs
publish it), else from the page's main content. Pages that need a sign-in or JavaScript to show the posting (e.g.
LinkedIn) come back as "couldn't read it — paste the text instead".
"""

import asyncio
import ipaddress
import json
import re
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

MAX_REDIRECTS = 4
MAX_BYTES = 2_000_000
MAX_TEXT = 20_000
MIN_TEXT = 200
TIMEOUT_S = 8.0
USER_AGENT = "Mozilla/5.0 (compatible; OrbitJobImport/1.0; +https://orbit.app)"

Resolver = Callable[[str, int], Awaitable[list[str]]]


class JobLinkError(Exception):
    """A message safe to show the user as-is."""


@dataclass
class JobPosting:
    url: str
    title: str | None
    company: str | None
    text: str


async def _resolve(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


def _public(addr: str) -> bool:
    ip = ipaddress.ip_address(addr.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _check_url(url: str) -> tuple[str, str, int]:
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise JobLinkError("That doesn't look like a web link. It should start with https://")
    if parts.username or parts.password:
        raise JobLinkError("Links with a username or password aren't supported.")
    default = 443 if parts.scheme == "https" else 80
    try:
        port = parts.port or default
    except ValueError as e:
        raise JobLinkError("That link has an invalid port.") from e
    if port != default:
        raise JobLinkError("Only standard web links are supported.")
    return parts.scheme, parts.hostname, port


async def _pinned_ip(host: str, port: int, resolve: Resolver) -> str:
    try:
        addrs = [host] if _is_ip(host) else await resolve(host, port)
    except OSError as e:
        raise JobLinkError("Couldn't find that website. Check the link.") from e
    if not addrs or not all(_public(a) for a in addrs):
        raise JobLinkError("That link points to a private address, so Orbit can't open it.")
    return addrs[0]


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


async def fetch_job_posting(url: str, *, resolve: Resolver = _resolve,
                            transport: httpx.AsyncBaseTransport | None = None) -> JobPosting:
    current = url.strip()
    async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_S, trust_env=False,
                                 follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            scheme, host, port = _check_url(current)
            ip = await _pinned_ip(host, port, resolve)
            parts = urlsplit(current)
            ip_host = f"[{ip}]" if ":" in ip else ip
            target = parts._replace(netloc=ip_host if port in (80, 443) else f"{ip_host}:{port}").geturl()
            headers = {"Host": host, "User-Agent": USER_AGENT,
                       "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9", "Accept-Language": "en"}
            extensions = {"sni_hostname": host} if scheme == "https" else {}
            try:
                async with client.stream("GET", target, headers=headers, extensions=extensions) as resp:
                    if resp.is_redirect and "location" in resp.headers:
                        current = urljoin(current, resp.headers["location"])
                        continue
                    if resp.status_code in (401, 403, 429, 999):
                        raise JobLinkError("That site doesn't let Orbit read the posting (it may need a sign-in). "
                                           "Copy the job description text and paste it instead.")
                    if resp.status_code >= 400:
                        raise JobLinkError(f"The page couldn't be opened (error {resp.status_code}). Check the link.")
                    ctype = resp.headers.get("content-type", "").lower()
                    if ctype and "html" not in ctype and "text/plain" not in ctype:
                        raise JobLinkError("That link isn't a web page. Paste the job description text instead.")
                    body = bytearray()
                    async for chunk in resp.aiter_bytes():
                        body += chunk
                        if len(body) > MAX_BYTES:
                            break
                    raw = bytes(body[:MAX_BYTES]).decode(resp.encoding or "utf-8", errors="replace")
            except httpx.HTTPError as e:
                raise JobLinkError("Couldn't reach that page. Check the link, or paste the text instead.") from e
            posting = extract_posting(raw, plain="text/plain" in ctype)
            posting.url = current
            return posting
    raise JobLinkError("That link redirects too many times.")


# ---- extraction ----------------------------------------------------------------------------------------------

_SKIP = {"script", "style", "noscript", "svg", "nav", "header", "footer", "form", "button", "template", "iframe"}
_BLOCK = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "tr",
          "main", "dd", "dt"}


class _Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.parts: list[str] = []
        self.main_parts: list[str] | None = None
        self.in_main = 0
        self.ld: list[str] = []
        self._ld_open = False
        self.title = ""
        self._in_title = False
        self.og_title: str | None = None
        self.og_site: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "script" and (a.get("type") or "").lower() == "application/ld+json":
            self._ld_open = True
            self.ld.append("")
            return
        if tag == "meta":
            prop = (a.get("property") or a.get("name") or "").lower()
            if prop == "og:title":
                self.og_title = a.get("content")
            elif prop == "og:site_name":
                self.og_site = a.get("content")
        if tag == "title":
            self._in_title = True
        if tag in _SKIP:
            self.skip += 1
        if tag in ("main", "article") or a.get("role") == "main":
            self.in_main += 1
            if self.main_parts is None:
                self.main_parts = []
        if tag in _BLOCK:
            self._emit("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._ld_open:
            self._ld_open = False
            return
        if tag == "title":
            self._in_title = False
        if tag in _SKIP and self.skip:
            self.skip -= 1
        if tag in ("main", "article") and self.in_main:
            self.in_main -= 1
        if tag in _BLOCK:
            self._emit("\n")

    def handle_data(self, data: str) -> None:
        if self._ld_open:
            self.ld[-1] += data
        elif self._in_title:
            self.title += data
        elif not self.skip:
            self._emit(data)

    def _emit(self, s: str) -> None:
        self.parts.append(s)
        if self.in_main and self.main_parts is not None:
            self.main_parts.append(s)


def _tidy(text: str) -> str:
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in text.splitlines()]
    out = "\n".join(ln for ln in lines if ln)
    return re.sub(r"\n{3,}", "\n\n", out)[:MAX_TEXT]


def html_to_text(html: str) -> str:
    p = _Page()
    p.feed(html)
    return _tidy("".join(p.main_parts if p.main_parts else p.parts))


def _job_postings(node: Any) -> list[dict[str, Any]]:
    """Every schema.org JobPosting in a JSON-LD blob (top level, a list, or an @graph)."""
    if isinstance(node, list):
        return [j for n in node for j in _job_postings(n)]
    if not isinstance(node, dict):
        return []
    found = []
    kind = node.get("@type")
    if kind == "JobPosting" or (isinstance(kind, list) and "JobPosting" in kind):
        found.append(node)
    return found + _job_postings(node.get("@graph") or [])


def extract_posting(raw: str, *, plain: bool = False) -> JobPosting:
    if plain:
        text = _tidy(raw)
        title = company = None
    else:
        page = _Page()
        page.feed(raw)
        title = unescape(page.og_title or page.title).strip() or None
        company = page.og_site
        text = ""
        for blob in page.ld:
            try:
                data = json.loads(blob)
            except json.JSONDecodeError:
                continue
            for job in _job_postings(data):
                desc = html_to_text(unescape(str(job.get("description") or "")))
                if len(desc) >= MIN_TEXT:
                    org = job.get("hiringOrganization")
                    company = (org.get("name") if isinstance(org, dict) else None) or company
                    title = str(job.get("title") or title or "").strip() or None
                    text = desc
                    break
            if text:
                break
        if not text:
            text = _tidy("".join(page.main_parts if page.main_parts else page.parts))
    if len(text) < MIN_TEXT:
        raise JobLinkError("Couldn't find a job description on that page (it may need a sign-in or JavaScript). "
                           "Copy the text and paste it instead.")
    return JobPosting(url="", title=(title or "")[:300] or None, company=(company or "")[:200] or None, text=text)
