"""Job-link import hardening (audit): the size cap holds after decompression, only identity or one gzip layer is
accepted, IPv6 forms that embed a private IPv4 are refused, and the whole fetch has a deadline."""

import asyncio
import gzip

import httpx
import pytest

from orbit_api.prep import job_link
from orbit_api.prep.job_link import JobLinkError, fetch_job_posting
from tests.test_job_link import LD_PAGE, public, transport


def streamed(body: bytes, **headers: str) -> httpx.Response:
    """A response read off the wire chunk by chunk, as in production (not already in memory)."""
    chunks = [body[i:i + 16_384] for i in range(0, len(body), 16_384)]

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):  # type: ignore[no-untyped-def]
            for c in chunks:
                yield c

    return httpx.Response(200, stream=Stream(), headers=headers)


async def test_a_gzip_bomb_is_cut_off_at_the_cap() -> None:
    bomb = gzip.compress(b"A" * (50 * job_link.MAX_BYTES))  # ~100 MB of text in a few hundred kB
    seen: list[int] = []
    real = job_link._read_capped

    async def spy(resp: httpx.Response) -> bytes:
        out = await real(resp)
        seen.append(len(out))
        return out

    import unittest.mock

    with unittest.mock.patch.object(job_link, "_read_capped", spy):
        posting = await fetch_job_posting("https://jobs.example/1", resolve=public(), transport=transport(
            lambda _: streamed(bomb, **{"content-type": "text/plain", "content-encoding": "gzip"})))
    assert seen == [job_link.MAX_BYTES]  # inflated to the cap, not to 100 MB
    assert len(posting.text) <= job_link.MAX_TEXT


async def test_stacked_or_unknown_encodings_are_refused() -> None:
    double = gzip.compress(gzip.compress(LD_PAGE.encode()))
    for encoding, body in (("gzip, gzip", double), ("br", b"x"), ("deflate", b"x")):
        with pytest.raises(JobLinkError, match="can't read"):
            await fetch_job_posting("https://jobs.example/1", resolve=public(), transport=transport(
                lambda _, b=body, e=encoding: streamed(b, **{"content-type": "text/html", "content-encoding": e})))


async def test_a_normal_gzip_page_still_reads() -> None:
    page = gzip.compress(LD_PAGE.encode())
    posting = await fetch_job_posting("https://jobs.example/1", resolve=public(), transport=transport(
        lambda _: streamed(page, **{"content-type": "text/html", "content-encoding": "gzip"})))
    assert "Kubernetes" in posting.text or len(posting.text) >= job_link.MIN_TEXT


@pytest.mark.parametrize("addr", ["64:ff9b::a9fe:a9fe", "64:ff9b::7f00:1", "::127.0.0.1", "fec0::1",
                                  "2002:7f00:1::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2"])
def test_ipv6_forms_hiding_a_private_address_are_refused(addr: str) -> None:
    assert job_link._public(addr) is False


def test_public_ipv6_and_ipv4_still_pass() -> None:
    assert job_link._public("2606:4700:4700::1111") and job_link._public("93.184.216.34")
    assert job_link._public("64:ff9b::5db8:d822")  # NAT64 of a public IPv4 (93.184.216.34)


async def test_the_whole_fetch_has_a_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(job_link, "TOTAL_TIMEOUT_S", 0.2)

    async def slow(host: str, port: int) -> list[str]:
        await asyncio.sleep(5)
        return ["93.184.216.34"]

    with pytest.raises(JobLinkError, match="too long"):
        await fetch_job_posting("https://jobs.example/1", resolve=slow)
