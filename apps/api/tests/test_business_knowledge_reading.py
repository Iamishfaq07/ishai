"""Content-bound self receipts, current-member coverage and published-only AI reading help."""

import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from orbit_api.business.knowledge_reading import fingerprint
from orbit_api.models import (
    BizAudit,
    BizCompany,
    BizKnowledgeDocument,
    BizKnowledgeReceipt,
    BizMember,
    ProviderRequest,
    User,
)
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, new_company, uid
from tests.test_business_knowledge import act, content, create, member, path, publish
from tests.test_business_knowledge_reviews import decision, fresh


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def reading(cid: str, did: str = "") -> str:
    return f"/v1/business/companies/{cid}/knowledge-reading" + (f"/{did}" if did else "")


def read(client: TestClient, who: dict[str, str], cid: str, did: str) -> dict[str, Any]:
    response = client.get(reading(cid, did), headers=auth(who))
    assert response.status_code == 200, response.text
    return dict(response.json())


def acknowledge(client: TestClient, who: dict[str, str], cid: str, row: dict[str, Any], **extra: Any) -> Any:
    return client.post(
        reading(cid, row["id"]) + "/acknowledge",
        headers=auth(who),
        json={"content_hash": row["content_hash"], "confirmed": True, **extra},
    )


def guide(client: TestClient, who: dict[str, str], cid: str, row: dict[str, Any]) -> Any:
    return client.post(
        reading(cid, row["id"]) + "/guide", headers=auth(who), json={"content_hash": row["content_hash"]}
    )


def test_reading_is_published_only_and_never_implicitly_acknowledged(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    reader = member(client, cid, "interviewer")
    doc = publish(client, owner, cid, create(client, owner, cid))
    saved = client.put(
        f"{path(cid)}/{doc['id']}",
        headers=auth(owner),
        json={"base_revision": doc["revision"], "data": content(body="PRIVATE DRAFT " * 10, audience="coordinators")},
    )
    assert saved.status_code == 200
    for person in (owner, reader):
        row = read(client, person, cid, doc["id"])
        assert row["data"] == content() and "PRIVATE" not in json.dumps(row)
        assert not row["acknowledged"] and row["acknowledged_at"] is None
        answer = guide(client, person, cid, row)
        assert answer.status_code == 200, answer.text
        assert not read(client, person, cid, doc["id"])["acknowledged"]
    assert acknowledge(client, reader, cid, row, confirmed=False).status_code == 422
    assert acknowledge(client, reader, cid, row, confirmed="true").status_code == 422
    assert acknowledge(client, reader, cid, row, user_id=uid(owner)).status_code == 422


def test_explicit_receipts_deduplicate_under_concurrency_and_can_be_withdrawn(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    doc = publish(client, owner, cid, create(client, owner, cid))
    row = read(client, owner, cid, doc["id"])
    barrier = Barrier(2)

    def send() -> Any:
        barrier.wait(timeout=10)
        return acknowledge(client, owner, cid, row)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    assert results[0].json()["acknowledged_at"] == results[1].json()["acknowledged_at"]

    async def counts(db: Any) -> tuple[int, int]:
        return (
            await db.scalar(
                select(func.count())
                .select_from(BizKnowledgeReceipt)
                .where(BizKnowledgeReceipt.document_id == doc["id"])
            ),
            await db.scalar(
                select(func.count())
                .select_from(BizAudit)
                .where(BizAudit.action == "knowledge.acknowledge", BizAudit.target == doc["id"])
            ),
        )

    assert db_call(client, counts) == (1, 1)
    at = read(client, owner, cid, doc["id"])["acknowledged_at"]
    assert acknowledge(client, owner, cid, row).json()["acknowledged_at"] == at
    assert client.delete(reading(cid, doc["id"]) + "/acknowledge", headers=auth(owner)).status_code == 200
    assert not read(client, owner, cid, doc["id"])["acknowledged"]
    assert db_call(client, counts) == (0, 1)


def test_wording_requires_fresh_receipt_but_private_edits_and_review_dates_do_not(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    doc = publish(client, owner, cid, create(client, owner, cid))
    original = read(client, owner, cid, doc["id"])
    assert acknowledge(client, owner, cid, original).status_code == 200
    assert decision(client, owner, cid, fresh(client, owner, cid, doc["id"])).status_code == 200
    current = read(client, owner, cid, doc["id"])
    assert current["acknowledged"] and current["content_hash"] == original["content_hash"]
    doc = client.get(f"{path(cid)}/{doc['id']}", headers=auth(owner)).json()
    saved = client.put(
        f"{path(cid)}/{doc['id']}",
        headers=auth(owner),
        json={
            "base_revision": doc["revision"],
            "data": content(body=content()["body"] + " Ask the coordinator for help."),
        },
    )
    assert saved.status_code == 200
    assert read(client, owner, cid, doc["id"])["acknowledged"]
    doc = publish(client, owner, cid, saved.json())
    assert acknowledge(client, owner, cid, original).status_code == 409
    assert guide(client, owner, cid, original).status_code == 409
    current = read(client, owner, cid, doc["id"])
    assert not current["acknowledged"] and current["acknowledged_at"]
    assert current["content_hash"] != original["content_hash"]
    assert acknowledge(client, owner, cid, current).json()["acknowledged"]
    # Exact same text can be republished without manufacturing unread work.
    archived = act(client, owner, cid, doc, "archive").json()
    restored = act(client, owner, cid, archived, "restore").json()
    publish(client, owner, cid, restored)
    assert read(client, owner, cid, doc["id"])["acknowledged"]


def test_coverage_uses_current_active_members_and_audience_with_private_reader_details(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    reader = member(client, cid, "interviewer")
    recruiter = member(client, cid, "recruiter")
    doc = publish(client, owner, cid, create(client, owner, cid))
    private = publish(client, owner, cid, create(client, owner, cid, audience="coordinators"))
    assert acknowledge(client, recruiter, cid, read(client, recruiter, cid, doc["id"])).status_code == 200
    assert acknowledge(client, reader, cid, read(client, reader, cid, doc["id"])).status_code == 200
    coverage = client.get(reading(cid) + "/coverage", headers=auth(owner)).json()
    rows = {r["id"]: r for r in coverage["items"]}
    assert (rows[doc["id"]]["eligible"], rows[doc["id"]]["acknowledged_count"], rows[doc["id"]]["remaining"]) == (
        3,
        2,
        1,
    )
    assert rows[private["id"]]["eligible"] == 2
    people = client.get(reading(cid, doc["id"]) + "/readers", headers=auth(owner)).json()
    assert people["total"] == 3 and sum(p["acknowledged"] for p in people["items"]) == 2
    assert all("email" not in p for p in people["items"])
    assert client.get(reading(cid, doc["id"]) + "/readers?offset=100", headers=auth(owner)).json()["items"] == []
    assert client.get(reading(cid) + "/coverage", headers=auth(reader)).status_code == 403
    assert client.get(reading(cid, doc["id"]) + "/readers", headers=auth(recruiter)).status_code == 403

    async def remove(db: Any) -> None:
        await db.execute(delete(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(reader)))
        user = await db.get(User, uid(recruiter))
        user.suspended_at = datetime.now(UTC)

    db_call(client, remove)
    rows = {r["id"]: r for r in client.get(reading(cid) + "/coverage", headers=auth(owner)).json()["items"]}
    assert rows[doc["id"]]["eligible"] == 1 and rows[doc["id"]]["acknowledged_count"] == 0


def test_tenant_audience_archive_and_delete_boundaries(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    reader = member(client, cid, "interviewer")
    outsider, other, _ = new_company(client)
    draft = create(client, owner, cid)
    assert client.get(reading(cid, draft["id"]), headers=auth(owner)).status_code == 404
    doc = publish(client, owner, cid, draft)
    row = read(client, owner, cid, doc["id"])
    assert client.get(reading(cid), headers=auth(outsider)).status_code == 404
    assert client.get(reading(other["id"], doc["id"]), headers=auth(outsider)).status_code == 404
    assert acknowledge(client, outsider, other["id"], row).status_code == 404
    restricted = publish(client, owner, cid, create(client, owner, cid, audience="coordinators"))
    restricted_row = read(client, owner, cid, restricted["id"])
    assert client.get(reading(cid, restricted["id"]), headers=auth(reader)).status_code == 404
    assert acknowledge(client, reader, cid, restricted_row).status_code == 404
    assert guide(client, reader, cid, restricted_row).status_code == 404
    assert len(client.get(reading(cid), headers=auth(reader)).json()["items"]) == 1
    assert acknowledge(client, owner, cid, row).status_code == 200
    archived = act(client, owner, cid, doc, "archive").json()
    assert client.get(reading(cid, doc["id"]), headers=auth(owner)).status_code == 404
    assert acknowledge(client, owner, cid, row).status_code == 404
    assert act(client, owner, cid, archived, "delete").status_code == 200

    async def count(db: Any) -> int:
        return int(
            await db.scalar(
                select(func.count())
                .select_from(BizKnowledgeReceipt)
                .where(BizKnowledgeReceipt.document_id == doc["id"])
            )
            or 0
        )

    assert db_call(client, count) == 0


def test_ai_is_bounded_exact_quoted_published_only_and_does_not_acknowledge(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    reader = member(client, cid, "interviewer")
    doc = publish(client, owner, cid, create(client, owner, cid, body="Read published guidance. " * 700))
    assert (
        client.put(
            f"{path(cid)}/{doc['id']}",
            headers=auth(owner),
            json={"base_revision": doc["revision"], "data": content(body="DO NOT LEAK PRIVATE DRAFT " * 8)},
        ).status_code
        == 200
    )
    original = MockLLMProvider.generate
    observed: list[str] = []

    async def spy(self: Any, request: Any) -> Any:
        observed.append(request.messages[-1].content)
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", spy)
    row = read(client, reader, cid, doc["id"])
    response = guide(client, reader, cid, row)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["source"] == "mock" and data["excerpts_truncated"]
    assert len(data["facts"]) == 6 and sum(len(f["text"]) for f in data["facts"]) <= 7200
    assert "PRIVATE DRAFT" not in observed[0]
    facts = {f["id"]: f["text"] for f in data["facts"]}
    assert all(t["source_quote"] in facts[t["fact_id"]] for t in data["tips"])
    assert not read(client, reader, cid, doc["id"])["acknowledged"]


@pytest.mark.parametrize("mutation,expected", [("content", 409), ("role", 404), ("suspend", 403)])
def test_ai_rechecks_content_and_access_after_generation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, mutation: str, expected: int
) -> None:
    from orbit_api.db import sessionmaker

    owner, company, _ = new_company(client)
    cid = company["id"]
    reader = member(client, cid, "recruiter")
    doc = publish(client, owner, cid, create(client, owner, cid, audience="coordinators"))
    row = read(client, reader, cid, doc["id"])
    original = MockLLMProvider.generate

    async def mutate(self: Any, request: Any) -> Any:
        async with sessionmaker()() as db:
            if mutation == "content":
                current = await db.get(BizKnowledgeDocument, doc["id"])
                current.published = {**current.published, "body": content()["body"] + " Changed during generation."}
            elif mutation == "role":
                person = await db.scalar(
                    select(BizMember).where(BizMember.user_id == uid(reader), BizMember.company_id == cid)
                )
                person.role = "interviewer"
            else:
                company_row = await db.get(BizCompany, cid)
                company_row.status = "suspended"
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", mutate)
    assert guide(client, reader, cid, row).status_code == expected


def test_company_ai_quota_counts_failed_attempts_and_resets_by_utc_day(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    reader = member(client, cid, "interviewer")
    doc = publish(client, owner, cid, create(client, owner, cid))
    row = read(client, reader, cid, doc["id"])

    async def fill(db: Any) -> None:
        for _ in range(10):
            db.add(
                ProviderRequest(
                    user_id=uid(owner),
                    company_id=cid,
                    provider="mock",
                    model="mock",
                    request_type="business_knowledge_reading",
                    ok=False,
                )
            )

    db_call(client, fill)
    assert guide(client, reader, cid, row).status_code == 429
    assert acknowledge(client, reader, cid, row).status_code == 200

    async def yesterday(db: Any) -> None:
        for record in await db.scalars(select(ProviderRequest).where(ProviderRequest.company_id == cid)):
            record.created_at = datetime.now(UTC) - timedelta(days=2)

    db_call(client, yesterday)
    assert guide(client, reader, cid, row).status_code == 200


def test_fingerprint_changes_only_for_reader_visible_guidance() -> None:
    original = content()
    assert fingerprint(original) == fingerprint({**original, "review_due": "2028-01-01"})
    for key, value in (
        ("title", "New title"),
        ("body", "Updated instructions"),
        ("audience", "coordinators"),
        ("category", "policy"),
    ):
        assert fingerprint(original) != fingerprint({**original, key: value})


def test_bad_ai_quote_is_rejected_without_recording_reading(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from dataclasses import replace

    owner, company, _ = new_company(client)
    cid = company["id"]
    doc = publish(client, owner, cid, create(client, owner, cid))
    row = read(client, owner, cid, doc["id"])
    original = MockLLMProvider.generate

    async def hallucinate(self: Any, request: Any) -> Any:
        response = await original(self, request)
        data = json.loads(response.text)
        for tip in data["tips"]:
            tip["source_quote"] = "This invented policy quote does not exist in the published document."
        return replace(response, text=json.dumps(data))

    monkeypatch.setattr(MockLLMProvider, "generate", hallucinate)
    assert guide(client, owner, cid, row).status_code == 502
    assert read(client, owner, cid, doc["id"])["acknowledged_at"] is None

    async def count(db: Any) -> int:
        return int(
            await db.scalar(
                select(func.count())
                .select_from(ProviderRequest)
                .where(
                    ProviderRequest.company_id == cid,
                    ProviderRequest.request_type == "business_knowledge_reading",
                    ProviderRequest.ok.is_(False),
                )
            )
            or 0
        )

    assert db_call(client, count) == 1


def test_audience_change_restricts_readers_and_invalidates_current_receipts(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    reader, recruiter = member(client, cid, "interviewer"), member(client, cid, "recruiter")
    doc = publish(client, owner, cid, create(client, owner, cid))
    for person in (reader, recruiter):
        assert acknowledge(client, person, cid, read(client, person, cid, doc["id"])).status_code == 200
    saved = client.put(
        f"{path(cid)}/{doc['id']}",
        headers=auth(owner),
        json={"base_revision": doc["revision"], "data": content(audience="coordinators")},
    )
    publish(client, owner, cid, saved.json())
    assert client.get(reading(cid, doc["id"]), headers=auth(reader)).status_code == 404
    assert not read(client, recruiter, cid, doc["id"])["acknowledged"]
    coverage = client.get(reading(cid) + "/coverage", headers=auth(owner)).json()["items"][0]
    assert coverage["eligible"] == 2 and coverage["acknowledged_count"] == 0
