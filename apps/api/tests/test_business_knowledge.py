"""Published Business knowledge, role-scoped evidence, revision checks and read-only AI answers."""

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from orbit_api.models import (
    BizKnowledgeDocument,
    BizKnowledgeEvent,
    BizKnowledgePublication,
    BizMember,
    ProviderRequest,
)
from tests.business_helpers import auth, db_call, make_client, new_company, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def path(cid: str) -> str:
    return f"/v1/business/companies/{cid}/knowledge"


def content(**extra: Any) -> dict[str, Any]:
    return {
        "title": "Independent interview feedback",
        "body": "Interview feedback policy: submit your independent scorecard before reading peer feedback. "
        "Record observed evidence and discuss disagreements in the debrief.",
        "category": "interview",
        "audience": "all_hiring",
        "review_due": "",
        **extra,
    }


def member(client: TestClient, cid: str, role: str) -> dict[str, str]:
    h = register(client, f"knowledge-{tag()}@example.com", role)

    async def seed(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(h), role=role))

    db_call(client, seed)
    return h


def create(client: TestClient, h: dict[str, str], cid: str, **extra: Any) -> dict[str, Any]:
    response = client.post(path(cid), headers=auth(h), json={"request_id": str(uuid.uuid4()), "data": content(**extra)})
    assert response.status_code == 200, response.text
    return dict(response.json())


def act(client: TestClient, h: dict[str, str], cid: str, row: dict[str, Any], action: str) -> Any:
    return client.post(
        f"{path(cid)}/{row['id']}/actions",
        headers=auth(h),
        json={
            "base_revision": row["revision"],
            "action": action,
            "note": "Reviewed this policy action with the recruiting team.",
        },
    )


def publish(client: TestClient, h: dict[str, str], cid: str, row: dict[str, Any]) -> dict[str, Any]:
    response = act(client, h, cid, row, "publish")
    assert response.status_code == 200, response.text
    return dict(response.json())


def ask(client: TestClient, h: dict[str, str], cid: str, **extra: Any) -> Any:
    version = client.get(path(cid), headers=auth(h)).json()["source_version"]
    return client.post(
        path(cid) + "/ask",
        headers=auth(h),
        json={"question": "How should independent interview feedback be recorded?", "source_version": version, **extra},
    )


def test_private_drafts_published_versions_and_reader_scope(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    interviewer = member(client, cid, "interviewer")
    row = create(client, owner, cid)
    assert client.get(path(cid), headers=auth(interviewer)).json()["items"] == []
    assert client.get(f"{path(cid)}/{row['id']}", headers=auth(interviewer)).status_code == 404
    row = publish(client, owner, cid, row)
    before = client.get(path(cid), headers=auth(interviewer)).json()
    saved = client.put(
        f"{path(cid)}/{row['id']}",
        headers=auth(owner),
        json={
            "base_revision": row["revision"],
            "data": content(
                title="Unpublished secret draft",
                body="Private draft: do not use this changed guidance until reviewed and published by the owner.",
            ),
        },
    )
    assert saved.status_code == 200, saved.text
    reader = client.get(f"{path(cid)}/{row['id']}", headers=auth(interviewer))
    assert reader.json()["data"] == content() and "Unpublished secret" not in reader.text
    after = client.get(path(cid), headers=auth(interviewer)).json()
    assert before["source_version"] == after["source_version"] and before["items"] == after["items"]
    assert (
        client.get(
            f"{path(cid)}/{row['id']}/versions/{row['published_revision']}", headers=auth(interviewer)
        ).status_code
        == 403
    )
    version = client.get(f"{path(cid)}/{row['id']}/versions/{row['published_revision']}", headers=auth(owner)).json()
    assert version["data"] == content()
    assert saved.json()["events"][0]["note"].startswith("Reviewed this policy")


def test_audience_tenant_scope_and_writer_permissions(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    manager, recruiter = member(client, cid, "hiring_manager"), member(client, cid, "recruiter")
    row = publish(client, owner, cid, create(client, owner, cid, audience="coordinators"))
    assert client.get(path(cid), headers=auth(manager)).json()["published_count"] == 0
    assert client.get(f"{path(cid)}/{row['id']}", headers=auth(manager)).status_code == 404
    assert ask(client, manager, cid, document_ids=[row["id"]]).status_code == 404
    assert client.get(f"{path(cid)}/{row['id']}", headers=auth(recruiter)).status_code == 200
    assert act(client, recruiter, cid, row, "archive").status_code == 403
    other, other_company, _ = new_company(client)
    assert client.get(f"{path(other_company['id'])}/{row['id']}", headers=auth(other)).status_code == 404
    assert (
        client.post(
            path(cid), headers=auth(manager), json={"request_id": str(uuid.uuid4()), "data": content()}
        ).status_code
        == 403
    )


def test_archive_restore_and_hard_delete_remove_evidence_and_snapshots(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    reader = member(client, cid, "interviewer")
    row = publish(client, owner, cid, create(client, owner, cid))
    row = act(client, owner, cid, row, "archive").json()
    assert client.get(path(cid), headers=auth(reader)).json()["items"] == []
    assert ask(client, reader, cid).json()["source"] == "none"
    row = act(client, owner, cid, row, "restore").json()
    assert row["published_revision"] is None and row["published"] is None
    assert client.get(f"{path(cid)}/{row['id']}", headers=auth(reader)).status_code == 404
    row = publish(client, owner, cid, row)
    assert act(client, owner, cid, row, "delete").json() == {"deleted": True}

    async def count(db: Any) -> tuple[int, int]:
        return (
            int(
                await db.scalar(
                    select(func.count())
                    .select_from(BizKnowledgePublication)
                    .where(BizKnowledgePublication.document_id == row["id"])
                )
                or 0
            ),
            int(
                await db.scalar(
                    select(func.count())
                    .select_from(BizKnowledgeEvent)
                    .where(BizKnowledgeEvent.document_id == row["id"])
                )
                or 0
            ),
        )

    assert db_call(client, count) == (0, 0)
    assert client.get(f"{path(cid)}/{row['id']}", headers=auth(owner)).status_code == 404


def test_cited_answer_checklist_overdue_and_no_match_abstention(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    row = publish(client, owner, cid, create(client, owner, cid, review_due="2020-01-01"))
    for mode in ("answer", "checklist"):
        response = ask(client, owner, cid, mode=mode)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "answered" and result["source"] == "mock" and result["mode"] == mode
        assert result["review_overdue"]
        passages = {p["id"]: p["text"] for p in result["sources"]}
        assert all(p["quote"] in passages[p["passage_id"]] for p in result["points"])
        assert all(p["document_id"] == row["id"] for p in result["sources"])
    unknown = ask(client, owner, cid, question="Xylophone volcanology zygomorphisms?")
    assert (
        unknown.status_code == 200 and unknown.json()["status"] == "insufficient" and unknown.json()["source"] == "none"
    )

    async def usage(db: Any) -> Any:
        return await db.scalar(
            select(func.count())
            .select_from(ProviderRequest)
            .where(ProviderRequest.company_id == cid, ProviderRequest.request_type == "business_knowledge_answer")
        )

    assert db_call(client, usage) == 2


def test_stale_writes_and_publication_race_are_revision_checked(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    row = create(client, owner, cid)
    barrier = Barrier(2)

    def once() -> Any:
        barrier.wait(timeout=10)
        return act(client, owner, cid, row, "publish")

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: once(), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    assert (
        client.put(
            f"{path(cid)}/{row['id']}", headers=auth(owner), json={"base_revision": row["revision"], "data": content()}
        ).status_code
        == 409
    )
    latest = client.get(f"{path(cid)}/{row['id']}", headers=auth(owner)).json()
    assert len(latest["history"]) == 1 and latest["events"][0]["action"] == "publish"


def test_invalid_citations_fail_without_changing_knowledge(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.providers.llm.mock import MockLLMProvider

    original = MockLLMProvider.generate
    owner, company, _ = new_company(client)
    cid = company["id"]
    row = publish(client, owner, cid, create(client, owner, cid))

    async def forged(self: Any, request: Any) -> Any:
        response = await original(self, request)
        response.text = (
            '{"status":"answered","points":[{"passage_id":"fabricated","quote":"invented policy",'
            '"text":"This claim has no source material."}]}'
        )
        return response

    monkeypatch.setattr(MockLLMProvider, "generate", forged)
    result = ask(client, owner, cid)
    assert result.status_code == 502, result.text
    assert client.get(f"{path(cid)}/{row['id']}", headers=auth(owner)).json()["revision"] == row["revision"]


def test_policy_withdrawn_during_generation_cannot_return_an_answer(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.providers.llm.mock import MockLLMProvider

    original = MockLLMProvider.generate
    owner, company, _ = new_company(client)
    cid = company["id"]
    row = publish(client, owner, cid, create(client, owner, cid))

    async def withdraw(self: Any, request: Any) -> Any:
        async with sessionmaker()() as db:
            document = await db.get(BizKnowledgeDocument, row["id"])
            assert document is not None
            document.archived = True
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", withdraw)
    response = ask(client, owner, cid)
    assert response.status_code == 409, response.text


def test_access_revoked_during_generation_is_rechecked(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.providers.llm.mock import MockLLMProvider

    original = MockLLMProvider.generate
    owner, company, _ = new_company(client)
    cid = company["id"]
    reader = member(client, cid, "recruiter")
    publish(client, owner, cid, create(client, owner, cid, audience="coordinators"))

    async def demote(self: Any, request: Any) -> Any:
        async with sessionmaker()() as db:
            role = await db.scalar(
                select(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(reader))
            )
            assert role is not None
            role.role = "interviewer"
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", demote)
    result = ask(client, reader, cid)
    assert result.status_code == 409, result.text


def test_source_version_and_content_bounds_are_enforced(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    before = client.get(path(cid), headers=auth(owner)).json()["source_version"]
    publish(client, owner, cid, create(client, owner, cid))
    stale = client.post(
        path(cid) + "/ask",
        headers=auth(owner),
        json={"question": "Independent feedback policy", "source_version": before},
    )
    assert stale.status_code == 409
    for bad in ({"body": "short"}, {"body": "x" * 20001}, {"review_due": "2026-99-01"}, {"audience": "everyone"}):
        invalid = client.post(
            path(cid), headers=auth(owner), json={"request_id": str(uuid.uuid4()), "data": content(**bad)}
        )
        assert invalid.status_code == 422


def test_derived_playbook_requires_current_sources_and_remains_a_draft(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    cid = company["id"]
    policy = publish(client, owner, cid, create(client, owner, cid))
    snapshot = client.get(path(cid), headers=auth(owner)).json()["source_version"]
    body = {
        "request_id": str(uuid.uuid4()),
        "source_version": snapshot,
        "data": content(title="Reviewed checklist draft", audience="coordinators", category="operations"),
    }
    draft = client.post(path(cid), headers=auth(owner), json=body)
    assert draft.status_code == 200, draft.text
    assert draft.json()["published_revision"] is None and draft.json()["published"] is None
    act(client, owner, cid, policy, "archive")
    # A retry of the already-created draft remains idempotent; new stale derivations fail.
    assert client.post(path(cid), headers=auth(owner), json=body).json()["id"] == draft.json()["id"]
    stale = client.post(path(cid), headers=auth(owner), json={**body, "request_id": str(uuid.uuid4())})
    assert stale.status_code == 409
