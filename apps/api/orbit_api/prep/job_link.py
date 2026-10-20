"""Import a job posting from a link (for Prep), without letting the link reach anything it shouldn't.

Fetching a user-supplied URL server-side is an SSRF risk, so:
- http(s) only, default ports only, no credentials in the URL;
- the host is resolved once and every address must be public (`is_global`) — no loopback, private, link-local
  (cloud metadata), CGNAT or reserved ranges;
- the connection goes to that checked IP (Host header + TLS SNI carry the name, so certificates still verify), so a
  second DNS answer can't swap in an internal address (DNS rebinding);
- redirects are followed by hand, re-checking every hop, at most MAX_REDIRECTS;
- a short timeout per read and for the whole fetch, a size cap that applies to the decompressed text (a few hundred
  compressed bytes can expand to gigabytes: only identity or a single gzip layer, inflated by hand with a cap),
  HTML/plain text only, and no proxy from the environment.

The text comes from the page's schema.org JobPosting data when present (Greenhouse, Lever, Workday, most ATSs
publish it), else from the page's main content. Pages that need a sign-in or JavaScript to show the posting (e.g.
LinkedIn) come back as "couldn't read it — paste the text instead".
"""

import asyncio
import ipaddress
import json
import re
import socket
import zlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import unquote, urljoin, urlsplit

import httpx

MAX_REDIRECTS = 4
MAX_BYTES = 2_000_000
MAX_TEXT = 20_000
MIN_TEXT = 200
TIMEOUT_S = 8.0
TOTAL_TIMEOUT_S = 20.0  # the whole fetch, redirects included: a server dripping bytes can't hold a request open
# Embedded IPv4 in IPv6: NAT64 (64:ff9b::a9fe:a9fe is 169.254.169.254), the deprecated IPv4-compatible ::a.b.c.d,
# and site-local fec0::/10, none of which `is_global` reliably rules out.
_NAT64 = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))
_BLOCKED_V6 = (ipaddress.ip_network("::/96"), ipaddress.ip_network("fec0::/10"))
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
    ip: ipaddress.IPv4Address | ipaddress.IPv6Address = ipaddress.ip_address(addr.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif any(ip in net for net in _BLOCKED_V6) or ip.teredo is not None:
            return False
        elif any(ip in net for net in _NAT64):
            ip = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
        elif ip.sixtofour is not None:
            ip = ip.sixtofour
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
        legacy = _legacy_ipv4(host)
        addrs = [host] if _is_ip(host) else [legacy] if legacy else await resolve(host, port)
    except OSError as e:
        raise JobLinkError("Couldn't find that website. Check the link.") from e
    if not addrs or not all(_public(a) for a in addrs):
        raise JobLinkError("That link points to a private address, so Orbit can't open it.")
    return addrs[0]


def _legacy_ipv4(host: str) -> str | None:
    """Normalize numeric IPv4 spellings before DNS, consistently on Windows and Unix (inet_aton syntax)."""
    if not re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+)){0,3}", host, re.I):
        return None
    try:
        pieces = host.split(".")
        values = [int(p, 16 if p.lower().startswith("0x") else 8 if len(p) > 1 and p.startswith("0") else 10)
                  for p in pieces]
        if any(v > 255 for v in values[:-1]) or values[-1] >= 2 ** (8 * (5 - len(values))):
            raise ValueError
        value = sum(v << (24 - 8 * i) for i, v in enumerate(values[:-1])) + values[-1]
        return str(ipaddress.IPv4Address(value))
    except ValueError as e:
        raise JobLinkError("That link points to a private address or invalid numeric host.") from e


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


async def fetch_job_posting(url: str, *, resolve: Resolver = _resolve,
                            transport: httpx.AsyncBaseTransport | None = None) -> JobPosting:
    try:
        async with asyncio.timeout(TOTAL_TIMEOUT_S):
            return await _fetch(url, resolve, transport)
    except TimeoutError as e:
        raise JobLinkError("That page took too long to load. Paste the job description text instead.") from e


async def fetch_reference_page(url: str, *, resolve: Resolver = _resolve,
                               transport: httpx.AsyncBaseTransport | None = None) -> JobPosting:
    """Public contact research uses the same pinned-DNS/redirect/size protections as job import."""
    try:
        async with asyncio.timeout(TOTAL_TIMEOUT_S):
            return await _fetch(url, resolve, transport, reference=True)
    except TimeoutError as e:
        raise JobLinkError("That page took too long to load. Paste the relevant public text instead.") from e


async def _read_capped(resp: httpx.Response) -> bytes:
    """The body, decompressed by hand to at most MAX_BYTES: only identity or one gzip layer is accepted."""
    encoding = resp.headers.get("content-encoding", "").strip().lower()
    if encoding not in ("", "identity", "gzip", "x-gzip"):
        raise JobLinkError("That page is sent in a way Orbit can't read. Paste the job description text instead.")
    inflate = zlib.decompressobj(16 + zlib.MAX_WBITS) if encoding in ("gzip", "x-gzip") else None
    body = bytearray()

    def take(chunk: bytes) -> bool:
        if inflate is not None:
            try:
                chunk = inflate.decompress(chunk, MAX_BYTES + 1 - len(body))
            except zlib.error as e:
                raise JobLinkError("That page couldn't be read. Paste the job description text instead.") from e
        body.extend(chunk)
        return len(body) > MAX_BYTES

    try:
        async for chunk in resp.aiter_raw():
            if take(chunk):
                break
    except httpx.StreamConsumed:  # a response already in memory (a test transport): decoded already; same cap
        inflate = None
        take(resp.content[:MAX_BYTES + 1])
    return bytes(body[:MAX_BYTES])


async def _fetch(url: str, resolve: Resolver, transport: httpx.AsyncBaseTransport | None,
                 *, reference: bool = False) -> JobPosting:
    current = url.strip()
    async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_S, trust_env=False,
                                 follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            scheme, host, port = _check_url(current)
            ip = await _pinned_ip(host, port, resolve)
            parts = urlsplit(current)
            ip_host = f"[{ip}]" if ":" in ip else ip
            target = parts._replace(netloc=ip_host if port in (80, 443) else f"{ip_host}:{port}").geturl()
            headers = {"Host": host, "User-Agent": USER_AGENT, "Accept-Encoding": "gzip, identity",
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
                    raw = (await _read_capped(resp)).decode(resp.encoding or "utf-8", errors="replace")
            except httpx.HTTPError as e:
                raise JobLinkError("Couldn't reach that page. Check the link, or paste the text instead.") from e
            # Parsing up to 2 MB of HTML is CPU work: a thread, so it doesn't stall the event loop.
            extractor = extract_reference if reference else extract_posting
            posting = await asyncio.to_thread(extractor, raw, plain="text/plain" in ctype)
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


class _ContactPage(_Page):
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        super().handle_starttag(tag, attrs)
        if tag == "a" and not self.skip:
            href = dict(attrs).get("href") or ""
            # Preserve published contact links in their surrounding text, never executable/link-login actions.
            if href.lower().startswith("mailto:"):
                self._emit(" " + unquote(href.split("?", 1)[0])[:500] + " ")
            elif re.match(r"https://(?:[\w-]+\.)?linkedin\.com/in/", href, re.I):
                self._emit(" " + href[:500] + " ")


def extract_reference(raw: str, *, plain: bool = False) -> JobPosting:
    page = _ContactPage()
    if not plain:
        page.feed(raw)
    content = _tidy(raw if plain else "".join(page.main_parts or page.parts))
    if not content:
        raise JobLinkError("No public text could be read. Paste the relevant text instead.")
    return JobPosting(url="", title=None, company=None, text=content)


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
