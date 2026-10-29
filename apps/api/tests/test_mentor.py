"""Ask a mentor: a mock report shared by a hashed, expiring, revocable link; the mentor's comments reach the owner."""
from typing import Any

from fastapi.testclient import TestClient

from tests.test_api import _register

ITEMS = [
    {"question": "Tell me about a time you led a project.", "score": 3, "feedback": "Name the result.",
     "you_said": "I led our billing migration.", "better": "I led the billing migration, which cut failures 40%."},
    {"question": "Why this company?", "score": 2, "feedback": "Be specific.", "you_said": "It's a great place.",
     "better": "Your payments work matches mine."},
]


def _seed(client: TestClient, sid: str, review: dict[str, Any] | None) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow, SessionSummary

    async def go() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row is not None
            row.status = "ended"
            db.add(SessionSummary(session_id=sid, content={"summary": "x", **({"review": review} if review else {}),
                                                           "delivery": {"words_per_minute": 140,
                                                                        "fillers_per_minute": 2.5}}))
            await db.commit()

    assert client.portal is not None
    client.portal.call(go)


def _mock(client: TestClient, h: dict[str, str], review: dict[str, Any] | None = None) -> str:
    r = client.post("/v1/sessions", headers=h, json={"title": "Acme mock", "type": "mock", "role": "Backend Engineer",
                                                      "company": "Acme"})
    assert r.status_code == 201, r.text
    sid = str(r.json()["id"])
    _seed(client, sid, review if review is not None else {"overall_score": 3, "strengths": ["Clear"],
                                                         "improvements": ["Results"], "items": ITEMS})
    return sid


def test_share_view_comment_notice_and_revoke(client: TestClient) -> None:
    h = _register(client)
    sid = _mock(client, h)
    r = client.post(f"/v1/sessions/{sid}/mentor-shares", headers=h, json={"label": "Priya", "days": 3})
    assert r.status_code == 201, r.text
    share = r.json()
    assert share["active"] and share["answers_included"] and share["views"] == 0
    token = share["url"].rsplit("/review/", 1)[1]

    # The mentor's view: the snapshot, no account data beyond a first name.
    view = client.get(f"/v1/public/mentor-review/{token}")
    assert view.status_code == 200, view.text
    report = view.json()["report"]
    assert report["role"] == "Backend Engineer" and report["company"] == "Acme" and report["overall_score"] == 3
    assert report["items"][0]["you_said"] == "I led our billing migration."
    assert "email" not in str(report) and "@" not in str(report)

    r = client.post(f"/v1/public/mentor-review/{token}/comments",
                    json={"author": "Priya", "body": "Lead with the 40% number.", "item": 0})
    assert r.status_code == 201, r.text
    client.post(f"/v1/public/mentor-review/{token}/comments", json={"author": "Priya", "body": "Good energy overall."})
    assert client.post(f"/v1/public/mentor-review/{token}/comments",
                       json={"author": "Priya", "body": "Out of range.", "item": 9}).status_code == 422

    mine = client.get(f"/v1/sessions/{sid}/mentor-shares", headers=h).json()
    assert mine[0]["views"] == 1 and mine[0]["url"] is None
    assert [(c["item"], c["read"]) for c in mine[0]["comments"]] == [(0, False), (None, False)]
    notices = client.get("/v1/notices", headers=h).json()
    items = notices["items"] if isinstance(notices, dict) else notices
    assert sum(1 for n in items if n["kind"] == "mentor") == 1  # one notice for the batch
    assert client.post("/v1/mentor-shares/read", headers=h, json={"session_id": sid}).status_code == 204
    assert all(c["read"] for c in client.get(f"/v1/sessions/{sid}/mentor-shares", headers=h).json()[0]["comments"])

    # Someone else can't see or turn off the owner's links.
    other = _register(client)
    assert client.get(f"/v1/sessions/{sid}/mentor-shares", headers=other).status_code == 404
    assert client.delete(f"/v1/mentor-shares/{share['id']}", headers=other).status_code == 404
    assert client.delete(f"/v1/mentor-shares/{share['id']}", headers=h).status_code == 204
    assert client.get(f"/v1/public/mentor-review/{token}").status_code == 404
    assert client.post(f"/v1/public/mentor-review/{token}/comments",
                       json={"author": "X", "body": "Too late"}).status_code == 404


def test_answers_can_stay_private_and_only_finished_mocks_share(client: TestClient) -> None:
    h = _register(client)
    sid = _mock(client, h)
    r = client.post(f"/v1/sessions/{sid}/mentor-shares", headers=h, json={"answers": False})
    token = r.json()["url"].rsplit("/review/", 1)[1]
    item = client.get(f"/v1/public/mentor-review/{token}").json()["report"]["items"][0]
    assert "you_said" not in item and "better" not in item and item["feedback"] == "Name the result."

    no_review = _mock(client, h, review={})
    assert client.post(f"/v1/sessions/{no_review}/mentor-shares", headers=h, json={}).status_code == 409
    assert client.get("/v1/public/mentor-review/" + "x" * 32).status_code == 404
