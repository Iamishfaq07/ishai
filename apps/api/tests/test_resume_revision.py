"""Resume saves and their revision (V3-06): every save bumps it; a save that names the revision it was based on is
refused (409) if another save landed since, so a stale tab, device or late request can't overwrite newer text.
Saves without a base revision (older clients) still land."""

import asyncio

import httpx
from fastapi.testclient import TestClient

from tests.test_api import _register


def _new(client: TestClient) -> tuple[dict[str, str], dict]:  # type: ignore[type-arg]
    h = _register(client)
    created = client.post("/v1/resumes", headers=h, json={"title": "Mine"})
    assert created.status_code == 201, created.text
    return h, created.json()


def _put(client: TestClient, h: dict[str, str], rid: str, title: str, base: int | None = None) -> httpx.Response:
    body: dict[str, object] = {"title": title}
    if base is not None:
        body["base_revision"] = base
    return client.put(f"/v1/resumes/{rid}", headers=h, json=body)


def test_each_save_bumps_the_revision(client: TestClient) -> None:
    h, r = _new(client)
    assert r["revision"] == 0
    assert client.get(f"/v1/resumes/{r['id']}", headers=h).json()["revision"] == 0
    first = _put(client, h, r["id"], "One", base=0)
    assert first.status_code == 200 and first.json()["revision"] == 1
    second = _put(client, h, r["id"], "Two", base=1)
    assert second.status_code == 200 and second.json()["revision"] == 2


def test_a_stale_save_is_refused_and_changes_nothing(client: TestClient) -> None:
    h, r = _new(client)
    assert _put(client, h, r["id"], "From tab one", base=0).status_code == 200
    stale = _put(client, h, r["id"], "From tab two", base=0)  # tab two opened revision 0 too
    assert stale.status_code == 409 and "another tab or device" in stale.json()["detail"]
    kept = client.get(f"/v1/resumes/{r['id']}", headers=h).json()
    assert kept["title"] == "From tab one" and kept["revision"] == 1


def test_an_older_client_without_a_base_revision_still_saves(client: TestClient) -> None:
    h, r = _new(client)
    assert _put(client, h, r["id"], "A", base=0).status_code == 200
    plain = _put(client, h, r["id"], "B")
    assert plain.status_code == 200 and plain.json()["revision"] == 2 and plain.json()["title"] == "B"


def test_concurrent_saves_from_one_revision_let_exactly_one_land(client: TestClient) -> None:
    h, r = _new(client)

    async def burst() -> list[int]:
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            replies = await asyncio.gather(*[
                http.put(f"/v1/resumes/{r['id']}", headers=h, json={"title": f"Tab {i}", "base_revision": 0})
                for i in range(5)])
        return [x.status_code for x in replies]

    codes = client.portal.call(burst)  # type: ignore[union-attr]
    assert sorted(codes) == [200, 409, 409, 409, 409], codes
    assert client.get(f"/v1/resumes/{r['id']}", headers=h).json()["revision"] == 1


def test_someone_elses_resume_is_still_not_found(client: TestClient) -> None:
    _h, r = _new(client)
    other = _register(client)
    assert _put(client, other, r["id"], "Mine now", base=0).status_code == 404
