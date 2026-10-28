"""Owned policy reviews, draft-safe confirmation, permission gates and deduplicated internal nudges."""

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.business.knowledge_reviews import sweep
from orbit_api.models import BizCompany, BizKnowledgeDocument, BizMember
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, new_company, uid
from tests.test_business_knowledge import ask, content, create, member, path, publish


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def reviews(cid: str) -> str:
    return f"/v1/business/companies/{cid}/knowledge-reviews"


def inbox(client: TestClient, who: dict[str, str], cid: str) -> dict[str, Any]:
    r = client.get(reviews(cid), headers=auth(who))
    assert r.status_code == 200, r.text
    return dict(r.json())


def assign(
    client: TestClient, who: dict[str, str], cid: str, row: dict[str, Any], owner: str | None, reminders: bool = True
) -> Any:
    return client.put(
        f"{reviews(cid)}/{row['id']}/owner",
        headers=auth(who),
        json={
            "base_revision": row["revision"],
            "owner_id": owner,
            "reminders": reminders,
            "note": "Assign a responsible reviewer for this guidance.",
        },
    )


def decision(
    client: TestClient, who: dict[str, str], cid: str, row: dict[str, Any], action: str = "confirm", **extra: Any
) -> Any:
    body = {
        "base_revision": row["revision"],
        "published_revision": row["published_revision"],
        "action": action,
        "next_review_date": (datetime.now(UTC).date() + timedelta(days=90)).isoformat() if action == "confirm" else "",
        "note": "Checked the published guidance with its current process owner.",
        **extra,
    }
    return client.post(f"{reviews(cid)}/{row['id']}/decision", headers=auth(who), json=body)


def fresh(client: TestClient, who: dict[str, str], cid: str, did: str) -> dict[str, Any]:
    return next(row for row in inbox(client, who, cid)["items"] if row["id"] == did)


def run(client: TestClient, who: dict[str, str], cid: str) -> Any:
    return client.post(reviews(cid) + "/reminders/run", headers=auth(who))


def test_inbox_ownership_and_due_states(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    today = datetime.now(UTC).date()
    due = publish(client, owner, cid, create(client, owner, cid, review_due=today.isoformat()))
    soon = publish(client, owner, cid, create(client, owner, cid, review_due=(today + timedelta(days=7)).isoformat()))
    no_date = publish(client, owner, cid, create(client, owner, cid))
    data = inbox(client, owner, cid)
    rows = {r["id"]: r for r in data["items"]}
    assert rows[due["id"]]["state"] == "due" and rows[soon["id"]]["state"] == "soon"
    assert rows[no_date["id"]]["state"] == "unscheduled"
    assert all(r["owner_id"] == uid(owner) and r["owner_available"] and not r["reminders"] for r in rows.values())
    assert len(data["owners"]) == 1


def test_confirm_published_guidance_preserves_private_body_audience_and_history(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    document = publish(client, owner, cid, create(client, owner, cid, review_due="2020-01-01"))
    before = document["published"]
    draft = content(
        title="Private changed policy",
        body="Draft: a proposed new procedure that has not been approved or published for company readers.",
        audience="coordinators",
        review_due="2020-01-01",
    )
    saved = client.put(
        f"{path(cid)}/{document['id']}",
        headers=auth(owner),
        json={"base_revision": document["revision"], "data": draft},
    )
    assert saved.status_code == 200
    row = fresh(client, owner, cid, document["id"])
    result = decision(client, owner, cid, row)
    assert result.status_code == 200, result.text
    current = client.get(f"{path(cid)}/{document['id']}", headers=auth(owner)).json()
    assert current["published"]["body"] == before["body"] and current["published"]["audience"] == "all_hiring"
    assert current["data"]["body"] == draft["body"] and current["data"]["audience"] == "coordinators"
    assert current["has_draft_changes"] and not current["needs_update"]
    assert current["published"]["review_due"] == current["data"]["review_due"]
    assert len(current["history"]) == 2 and current["events"][0]["action"] == "review_confirm"
    assert decision(client, owner, cid, row).status_code == 409
    assert (
        client.put(
            f"{path(cid)}/{document['id']}",
            headers=auth(owner),
            json={"base_revision": saved.json()["revision"], "data": draft},
        ).status_code
        == 409
    )


def test_update_request_marks_ai_citations_and_publication_clears_flag(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    document = publish(client, owner, cid, create(client, owner, cid))
    row = fresh(client, owner, cid, document["id"])
    assert decision(client, owner, cid, row, "needs_update").status_code == 200
    assert fresh(client, owner, cid, document["id"])["state"] == "needs_update"
    answer = ask(client, owner, cid)
    assert answer.status_code == 200 and answer.json()["needs_update"]
    assert any(s["needs_update"] for s in answer.json()["sources"])
    current = client.get(f"{path(cid)}/{document['id']}", headers=auth(owner)).json()
    saved = client.put(
        f"{path(cid)}/{document['id']}",
        headers=auth(owner),
        json={
            "base_revision": current["revision"],
            "data": content(body=content()["body"] + " Confirm the panel's review schedule with the coordinator."),
        },
    )
    assert saved.status_code == 200
    current = publish(client, owner, cid, saved.json())
    assert not current["needs_update"]


def test_reminders_opt_in_deduplicate_and_follow_assignment_episode(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    doc = publish(client, owner, cid, create(client, owner, cid, review_due="2020-01-01"))
    assert run(client, owner, cid).json()["created"] == 0
    row = fresh(client, owner, cid, doc["id"])
    assert assign(client, owner, cid, row, uid(owner)).status_code == 200
    barrier = Barrier(2)

    def send() -> Any:
        barrier.wait(timeout=10)
        return run(client, owner, cid)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert all(r.status_code == 200 for r in results)
    assert sum(r.json()["created"] for r in results) == 1
    assert run(client, owner, cid).json()["created"] == 0
    admin = member(client, cid, "admin")
    row = fresh(client, owner, cid, doc["id"])
    assert assign(client, owner, cid, row, uid(admin)).status_code == 200
    assert run(client, owner, cid).json()["created"] == 1
    notifications = client.get("/v1/business/notifications", headers=auth(admin)).json()
    assert notifications[0]["kind"] == "knowledge_review" and notifications[0]["link"].endswith("/knowledge-reviews")
    row = fresh(client, owner, cid, doc["id"])
    assert decision(client, owner, cid, row).status_code == 200
    assert run(client, owner, cid).json()["created"] == 0
    row = fresh(client, owner, cid, doc["id"])
    assert decision(client, owner, cid, row, "needs_update").status_code == 200
    assert run(client, owner, cid).json()["created"] == 1


def test_removed_owner_suspension_and_background_reminder_run(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    admin = member(client, cid, "admin")
    doc = publish(client, owner, cid, create(client, owner, cid, review_due="2020-01-01"))
    row = fresh(client, owner, cid, doc["id"])
    assert assign(client, owner, cid, row, uid(admin)).status_code == 200

    async def demote(db: Any) -> None:
        person = await db.scalar(select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(admin)))
        person.role = "interviewer"

    db_call(client, demote)
    result = run(client, owner, cid)
    assert result.json() == {"created": 0, "unavailable_owner": 1}
    row = fresh(client, owner, cid, doc["id"])
    assert not row["owner_available"]
    assert assign(client, owner, cid, row, uid(admin)).status_code == 422
    assert assign(client, owner, cid, row, None).status_code == 422
    assert assign(client, owner, cid, row, uid(owner)).status_code == 200
    assert client.portal.call(sweep) == 1
    assert client.portal.call(sweep) == 0

    async def suspend(db: Any) -> None:
        company = await db.get(BizCompany, cid)
        company.status = "suspended"

    db_call(client, suspend)
    assert run(client, owner, cid).status_code == 403
    assert client.portal.call(sweep) == 0


def test_tenant_permissions_and_invalid_review_dates(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    outsider, other, _ = new_company(client)
    recruiter = member(client, cid, "recruiter")
    doc = publish(client, owner, cid, create(client, owner, cid))
    row = fresh(client, owner, cid, doc["id"])
    assert client.get(reviews(cid), headers=auth(recruiter)).status_code == 403
    assert decision(client, recruiter, cid, row).status_code == 403
    assert decision(client, outsider, other["id"], row).status_code == 404
    assert assign(client, owner, cid, row, uid(outsider)).status_code == 422
    for invalid in ("2020-01-01", "2039-01-01", "2026-99-01"):
        assert decision(client, owner, cid, row, next_review_date=invalid).status_code == 422
    assert decision(client, owner, cid, row, "needs_update", next_review_date="2027-01-01").status_code == 422
    # A private, separately scheduled draft date is preserved during confirmation.
    current = client.get(f"{path(cid)}/{doc['id']}", headers=auth(owner)).json()
    saved = client.put(
        f"{path(cid)}/{doc['id']}",
        headers=auth(owner),
        json={"base_revision": current["revision"], "data": content(review_due="2028-01-01")},
    )
    assert saved.status_code == 200
    row = fresh(client, owner, cid, doc["id"])
    assert decision(client, owner, cid, row).status_code == 200
    assert client.get(f"{path(cid)}/{doc['id']}", headers=auth(owner)).json()["data"]["review_due"] == "2028-01-01"


def test_ai_review_is_quoted_and_cannot_record_a_decision(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    doc = publish(client, owner, cid, create(client, owner, cid))
    row = fresh(client, owner, cid, doc["id"])
    response = client.post(
        f"{reviews(cid)}/{row['id']}/brief", headers=auth(owner), json={"base_revision": row["revision"]}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    facts = {f["id"]: f["text"] for f in data["facts"]}
    assert all(tip["source_quote"] in facts[tip["fact_id"]] for tip in data["tips"])
    assert data["source"] == "mock"
    assert fresh(client, owner, cid, row["id"])["revision"] == row["revision"]


def test_ai_review_rejects_an_edit_made_during_generation(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.db import sessionmaker

    original = MockLLMProvider.generate
    owner, company, _ = new_company(client)
    cid = company["id"]
    doc = publish(client, owner, cid, create(client, owner, cid))
    row = fresh(client, owner, cid, doc["id"])

    async def edit(self: Any, request: Any) -> Any:
        async with sessionmaker()() as db:
            current = await db.get(BizKnowledgeDocument, doc["id"])
            assert current is not None
            current.revision += 1
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", edit)
    response = client.post(
        f"{reviews(cid)}/{row['id']}/brief", headers=auth(owner), json={"base_revision": row["revision"]}
    )
    assert response.status_code == 409
