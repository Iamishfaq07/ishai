"""Broken access control (OWASP A01): an IDOR matrix over every route that takes an object id, the 401 wall in front
of every non-public route, the admin wall, mass assignment, and the live-socket tickets.

One "world" is built per module (one app, so no second app ever shares the DB engine with it): user A owns one of
everything (two documents, a resume, a saved setup, a story, an ended session with transcript, a question, an answer and
a report, an open session shared to a phone, a UPI order with its UTR); user B is another normal account with a session,
a setup and a document of their own. Every attempt B makes on A's objects must answer 404 (or 403) and leave A's data
exactly as A sees it. Sign-up approval is on, so the admin approves A and B (and "approved": true in a sign-up body can
be shown to do nothing).
"""

import json
import re
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from httpx import Response
from starlette.websockets import WebSocketDisconnect

from orbit_api.config import get_settings
from orbit_api.sessions import companion
from tests.test_api import _collect, _doc
from tests.test_resumes import JOB, strong_resume
from tests.test_signup_approval import _client

PW = "correct horse battery"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
REVIEW = {"overall_score": 2, "items": [
    {"question": "Describe a conflict with a teammate.", "you_said": "We disagreed.", "score": 2,
     "feedback": "No resolution or outcome."}]}


# ---- the world ----------------------------------------------------------------------------------------------------


@dataclass
class World:
    client: TestClient
    admin: dict[str, str]
    a: dict[str, str]
    b: dict[str, str]
    ids: dict[str, str]

    def call(self, method: str, path: str, who: dict[str, str] | None, **kw: Any) -> Response:
        self.client.cookies.clear()  # bearer only: nothing from an earlier response rides along
        return self.client.request(method, _fill(path, self.ids), headers=who or {}, **_fill(kw, self.ids))

    def get(self, path: str, who: dict[str, str]) -> Any:
        r = self.call("GET", path, who)
        assert r.status_code == 200, (path, r.status_code, r.text)
        return r.json()


def _fill(value: Any, ids: dict[str, str]) -> Any:
    """`{name}` placeholders in paths and JSON bodies become the world's ids (anything else is left alone)."""
    if isinstance(value, str):
        return re.sub(r"\{(\w+)\}", lambda m: ids.get(m.group(1), m.group(0)), value)
    if isinstance(value, dict):
        return {k: _fill(v, ids) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill(v, ids) for v in value]
    return value


def _signup(client: TestClient, email: str, **extra: Any) -> tuple[dict[str, str], dict[str, Any]]:
    client.cookies.clear()
    r = client.post("/v1/auth/register", json={"email": email, "password": PW, **extra})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


def _email(tag: str) -> str:
    return f"idor-{tag}-{uuid.uuid4().hex[:8]}@example.com"


def approve_leftovers(client: TestClient, email_prefix: str) -> None:
    """The test DB is shared by the whole run: accounts this module left waiting for approval would show up in other
    tests' "pending" lists."""
    from sqlalchemy import update

    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(User).where(User.email.like(f"{email_prefix}%")).values(approved=True))
            await db.commit()

    client.portal.call(go)  # type: ignore[union-attr]


def _created(r: Response) -> str:
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def _insert_listing(client: TestClient) -> str:
    """A cached job post, as a source refresh leaves it (listings are shared: nobody owns them)."""
    from orbit_api.db import sessionmaker
    from orbit_api.job_portal.postings import dedupe_key, listing_id
    from orbit_api.models import JobListing

    external = uuid.uuid4().hex
    lid = listing_id("greenhouse", external)

    async def go() -> None:
        async with sessionmaker()() as db:
            now = datetime.now(UTC)
            db.add(JobListing(id=lid, source="greenhouse", external_id=external, board="idor", company="Acme",
                              title="Staff Engineer", locations=["Bengaluru, India"], cities=["Bengaluru"],
                              country="IN", workplace="hybrid", employment_type="full_time", posted_at=now,
                              url="https://example.com/jobs/staff", apply_url="https://example.com/jobs/staff/apply",
                              snippet="Lead the platform.", description="Lead the platform team. Go and Kafka. " * 30,
                              keywords=["Go", "Kafka"], text_hash="x", fetched_at=now,
                              dedupe_key=dedupe_key("Acme", f"Staff Engineer {external}", ["Bengaluru"], "hybrid")))
            await db.commit()

    client.portal.call(go)  # type: ignore[union-attr]
    return lid


def _insert_answer(client: TestClient, session_id: str) -> str:
    from orbit_api.db import sessionmaker
    from orbit_api.models import Answer

    aid = str(uuid.uuid4())

    async def go() -> None:
        async with sessionmaker()() as db:
            db.add(Answer(id=aid, session_id=session_id, question_id=None, status="completed",
                          content={"talking_points": ["Set up a design review"], "question": "Conflict?"},
                          provider="mock", model="mock-1", first_token_ms=120, total_ms=900))
            await db.commit()

    client.portal.call(go)  # type: ignore[union-attr]
    return aid


def _seed_ended_session(client: TestClient, session_id: str) -> dict[str, str]:
    """What a finished interview leaves behind: transcript turns, a question, an answer and a report with a review."""
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow, Question, SessionSummary, SessionTurn

    qid = str(uuid.uuid4())

    async def go() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, session_id)
            assert row is not None
            row.status, row.ended_at, row.duration_s = "ended", datetime.now(UTC), 600
            db.add_all([
                SessionTurn(id=str(uuid.uuid4()), session_id=session_id, speaker="interviewer",
                            text="Tell me about a conflict with a teammate.", start_ms=0, end_ms=2000),
                SessionTurn(id=str(uuid.uuid4()), session_id=session_id, speaker="candidate",
                            text="We disagreed about the rollout plan, so I set up a design review and we settled it "
                                 "with load-test data.", start_ms=2500, end_ms=9000),
                Question(id=qid, session_id=session_id, text="Tell me about a conflict with a teammate.",
                         type="behavioral", confidence=0.9),
                SessionSummary(session_id=session_id, content={"summary": "A solid behavioral round.",
                                                               "review": REVIEW}),
            ])
            await db.commit()

    client.portal.call(go)  # type: ignore[union-attr]
    return {"question": qid, "answer": _insert_answer(client, session_id)}


@pytest.fixture(scope="module")
def world() -> Iterator[World]:
    admin_email = _email("admin")
    with pytest.MonkeyPatch.context() as mp:
        gen = _client(mp, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_UPI_ID="owner@okicici", ORBIT_SIGNUP_APPROVAL="true")
        client = next(gen)
        try:
            admin, _ = _signup(client, admin_email)
            a, a_user = _signup(client, _email("a"), name="Alice")
            b, b_user = _signup(client, _email("b"), name="Bob")
            for uid in (a_user["id"], b_user["id"]):
                r = client.post(f"/v1/admin/users/{uid}/access", headers=admin, json={"action": "approve"})
                assert r.status_code == 200, r.text
            ids = {"a_id": a_user["id"], "b_id": b_user["id"], "a_email": a_user["email"]}

            # A: one of everything.
            ids["doc_resume"], ids["doc_jd"] = _doc(client, a, "resume_sample"), _doc(client, a, "jd_sample")
            ids["resume"] = _created(client.post("/v1/resumes", headers=a, json={
                "title": "Alice's CV", "data": strong_resume().model_dump(mode="json"), "job_text": JOB}))
            ids["workspace"] = _created(client.post("/v1/workspaces", headers=a, json={
                "name": "Acme — Staff Engineer", "company": "Acme", "notes": "Mention the Kafka migration.",
                "document_ids": [ids["doc_resume"], ids["doc_jd"]]}))
            ids["story"] = _created(client.post("/v1/stories", headers=a, json={
                "title": "Settled a rollout dispute with data", "situation": "Two teams disagreed.",
                "action": "I ran a design review.", "result": "We shipped on time.", "competencies": ["conflict"]}))
            ids["saved_answer"] = _created(client.post("/v1/answers", headers=a, json={
                "question": "Tell me about yourself.", "answer": "I'm a backend engineer at Acme."}))
            ids["s_ended"] = _created(client.post("/v1/sessions", headers=a, json={
                "title": "Acme onsite", "workspace_id": ids["workspace"]}))
            ids.update(_seed_ended_session(client, ids["s_ended"]))
            ids["s_open"] = _created(client.post("/v1/sessions", headers=a, json={"title": "Globex phone screen"}))
            order = client.post("/v1/billing/upi/orders", headers=a, json={"pack": "starter"})
            ids["order"] = _created(order)
            ids["utr"] = f"{uuid.uuid4().int % 10**12:012d}"
            utr = client.post(f"/v1/billing/upi/orders/{ids['order']}/utr", headers=a, json={"utr": ids["utr"]})
            assert utr.status_code == 200, utr.text
            share = client.post(f"/v1/sessions/{ids['s_open']}/companion", headers=a)
            assert share.status_code == 200, share.text
            ids["share_code"] = share.json()["code"]
            # Jobs: a cached listing (shared by everyone), A's job profile matched to A's resume, and A's tracker entry.
            ids["listing"] = _insert_listing(client)
            r = client.put("/v1/jobs/profile", headers=a, json={"prefs": {"titles": ["Staff Engineer"]},
                                                               "resume_id": ids["resume"]})
            assert r.status_code == 200, r.text
            ids["job_entry"] = _created(client.post("/v1/jobs/tracker", headers=a, json={
                "listing_id": ids["listing"], "status": "applied"}))
            note = client.patch(f"/v1/jobs/tracker/{ids['job_entry']}", headers=a,
                                json={"notes": "Alice's recruiter call notes"})
            assert note.status_code == 200, note.text
            # A message A sent from the Contact page (only the admin may see or touch it).
            sent = client.post("/v1/contact", headers=a, json={
                "name": "Alice", "email": a_user["email"], "topic": "payment",
                "message": "My UTR is 123456789012 and the credits haven't arrived."})
            assert sent.status_code == 201, sent.text
            ids["a_message"] = client.get("/v1/admin/inbox", headers=admin, params={
                "q": sent.json()["reference"], "status": "all"}).json()["items"][0]["id"]

            # B: a few things of their own, to point at A's.
            ids["b_doc"] = _doc(client, b, "jd_sample")
            ids["b_session"] = _created(client.post("/v1/sessions", headers=b, json={"title": "Bob's session"}))
            ids["b_workspace"] = _created(client.post("/v1/workspaces", headers=b, json={"name": "Bob's setup"}))
            yield World(client, admin, a, b, ids)
        finally:
            approve_leftovers(client, "idor-")
            gen.close()
    get_settings.cache_clear()


def _owner_view(w: World) -> dict[str, Any]:
    """Everything A can see about A's objects (compared before and after each of B's attempts)."""
    a = w.a
    return {
        "documents": w.get("/v1/documents", a),
        "resume_doc": w.get("/v1/documents/{doc_resume}/text", a),
        "jd_doc": w.get("/v1/documents/{doc_jd}/text", a),
        "resume": w.get("/v1/resumes/{resume}", a),
        "workspace": w.get("/v1/workspaces/{workspace}", a),
        "stories": w.get("/v1/stories", a),
        "saved_answers": w.get("/v1/answers", a),
        "ended": w.get("/v1/sessions/{s_ended}", a),
        "open": w.get("/v1/sessions/{s_open}", a),
        "orders": w.get("/v1/billing/upi/orders", a),
        "entitlements": w.get("/v1/entitlements", a),
        "sharing": w.ids["share_code"] in companion._shares,
        "job_tracker": w.get("/v1/jobs/tracker", a),
        "job_profile": w.get("/v1/jobs/profile", a)["prefs"],
        "job_resume": w.get("/v1/jobs/profile", a)["resume"],
    }


def _ws_close_code(client: TestClient, url: str, **kw: Any) -> int:
    with pytest.raises(WebSocketDisconnect) as closed, client.websocket_connect(url, **kw) as ws:
        ws.receive_text()
    return int(closed.value.code)


def test_world_is_what_the_matrix_expects(world: World) -> None:
    view = _owner_view(world)
    assert len(view["documents"]) == 2 and view["sharing"] is True
    assert view["ended"]["session"]["status"] == "ended" and view["ended"]["turns"] and view["ended"]["answers"]
    assert view["open"]["session"]["status"] != "ended"
    assert view["orders"][0]["status"] == "submitted" and view["orders"][0]["utr"] == world.ids["utr"]
    assert view["entitlements"]["plan"] == "free"
    assert [(t["id"], t["status"]) for t in view["job_tracker"]] == [(world.ids["job_entry"], "applied")]
    assert view["job_resume"]["id"] == world.ids["resume"] and view["job_profile"]["titles"] == ["Staff Engineer"]


# ---- B against A's objects (read, update, delete, actions) ------------------------------------------------------

OBJECT_ROUTES: list[tuple[str, str, dict[str, Any]]] = [
    ("GET", "/v1/documents/{doc_resume}/text", {}),
    ("PATCH", "/v1/documents/{doc_resume}", {"json": {"title": "pwned", "text": "pwned by bob " * 5}}),
    ("PATCH", "/v1/documents/{doc_jd}", {"json": {"kind": "other"}}),
    ("DELETE", "/v1/documents/{doc_jd}", {}),
    ("GET", "/v1/resumes/{resume}", {}),
    ("PUT", "/v1/resumes/{resume}", {"json": {"title": "pwned", "cover_letter": "pwned"}}),
    ("DELETE", "/v1/resumes/{resume}", {}),
    ("GET", "/v1/workspaces/{workspace}", {}),
    ("PUT", "/v1/workspaces/{workspace}", {"json": {"name": "pwned", "document_ids": []}}),
    ("DELETE", "/v1/workspaces/{workspace}", {}),
    ("PUT", "/v1/stories/{story}", {"json": {"title": "pwned"}}),
    ("DELETE", "/v1/stories/{story}", {}),
    ("PUT", "/v1/answers/{saved_answer}", {"json": {"question": "pwned", "answer": "pwned"}}),
    ("DELETE", "/v1/answers/{saved_answer}", {}),
    ("GET", "/v1/sessions/{s_ended}", {}),
    ("GET", "/v1/sessions/{s_ended}/export.md", {}),
    ("POST", "/v1/sessions/{s_open}/end", {}),
    ("POST", "/v1/sessions/{s_ended}/report/retry", {}),
    ("DELETE", "/v1/sessions/{s_ended}/transcript", {}),
    ("POST", "/v1/sessions/{s_ended}/review", {}),
    ("POST", "/v1/sessions/{s_ended}/drill", {}),
    ("POST", "/v1/sessions/{s_ended}/follow-up", {}),
    ("POST", "/v1/sessions/{s_ended}/follow-up?refresh=true", {}),
    ("DELETE", "/v1/sessions/{s_ended}", {}),
    ("DELETE", "/v1/sessions/{s_open}", {}),
    ("POST", "/v1/sessions/{s_open}/live-ticket", {}),
    ("POST", "/v1/sessions/{s_open}/screenshots", {"files": {"image": ("s.png", PNG, "image/png")}}),
    ("POST", "/v1/sessions/{s_open}/companion", {}),
    ("DELETE", "/v1/sessions/{s_open}/companion", {}),
    ("PUT", "/v1/sessions/{s_ended}/answers/{answer}/feedback", {"json": {"rating": "down", "reason": "inaccurate"}}),
    ("PUT", "/v1/sessions/{s_ended}/answers/{answer}/feedback", {"json": {"rating": None}}),
    ("POST", "/v1/billing/upi/orders/{order}/utr", {"json": {"utr": "999988887777"}}),
    ("PATCH", "/v1/jobs/tracker/{job_entry}", {"json": {"status": "rejected", "notes": "pwned"}}),
    ("PATCH", "/v1/jobs/tracker/{job_entry}", {"json": {"clear_next": True, "applied_at": "2020-01-01T00:00:00Z"}}),
    ("DELETE", "/v1/jobs/tracker/{job_entry}", {}),
]


@pytest.mark.parametrize(("method", "path", "kw"), OBJECT_ROUTES,
                         ids=[f"{m} {p}" + (" (clear)" if k.get("json") == {"rating": None} else "")
                              for m, p, k in OBJECT_ROUTES])
def test_another_user_cannot_read_change_or_act_on_owners_object(world: World, method: str, path: str,
                                                                 kw: dict[str, Any]) -> None:
    before = _owner_view(world)
    r = world.call(method, path, world.b, **kw)
    assert r.status_code in (403, 404), f"B got {r.status_code} on A's object: {r.text[:300]}"
    assert world.ids["a_email"] not in r.text and "Alice" not in r.text  # nothing of A's in the refusal either
    assert _owner_view(world) == before


# B's own requests that name A's objects in the body (document_ids, workspace_id, resume_id, document_id ...).
REFERENCE_ROUTES: list[tuple[str, str, dict[str, Any]]] = [
    ("POST", "/v1/sessions", {"json": {"title": "B with A's resume", "document_ids": ["{doc_resume}"]}}),
    ("POST", "/v1/sessions", {"json": {"title": "B mixes docs", "document_ids": ["{b_doc}", "{doc_jd}"]}}),
    ("POST", "/v1/sessions", {"json": {"title": "B with A's setup", "workspace_id": "{workspace}"}}),
    ("POST", "/v1/sessions", {"json": {"title": "B mock", "type": "mock", "workspace_id": "{workspace}"}}),
    ("POST", "/v1/workspaces", {"json": {"name": "B with A's JD", "document_ids": ["{doc_jd}"]}}),
    ("PUT", "/v1/workspaces/{b_workspace}", {"json": {"name": "Bob's setup", "document_ids": ["{doc_jd}"]}}),
    ("POST", "/v1/prep", {"json": {"job_description_id": "{doc_jd}"}}),
    ("POST", "/v1/prep", {"json": {"job_text": JOB, "resume_id": "{doc_resume}"}}),
    ("POST", "/v1/stories/draft", {"json": {"source": "resume", "resume_id": "{doc_resume}"}}),
    ("POST", "/v1/resumes/import", {"json": {"source": "document", "document_id": "{doc_resume}"}}),
    ("PUT", "/v1/jobs/profile", {"json": {"prefs": {}, "resume_id": "{resume}"}}),
    ("POST", "/v1/jobs/profile/suggest", {"json": {"resume_id": "{resume}"}}),
    ("POST", "/v1/jobs/listings/{listing}/tailor", {"json": {"resume_id": "{resume}"}}),
]


@pytest.mark.parametrize(("method", "path", "kw"), REFERENCE_ROUTES,
                         ids=[f"{m} {p} {json.dumps(k['json'])[:60]}" for m, p, k in REFERENCE_ROUTES])
def test_another_user_cannot_use_owners_ids_in_a_request_body(world: World, method: str, path: str,
                                                              kw: dict[str, Any]) -> None:
    before = _owner_view(world)
    r = world.call(method, path, world.b, **kw)
    assert r.status_code in (403, 404), f"B got {r.status_code} using A's id: {r.text[:300]}"
    assert _owner_view(world) == before
    # and nothing of B's ended up pointing at A's documents
    mine = {d["id"] for d in world.get("/v1/documents", world.b)}
    for s in world.get("/v1/sessions", world.b):
        assert set(s["document_ids"]) <= mine and s["workspace_id"] != world.ids["workspace"]
    for ws in world.get("/v1/workspaces", world.b):
        assert set(ws["document_ids"]) <= mine


def test_another_user_cannot_claim_owners_answer_through_their_own_session(world: World) -> None:
    """Ratings are keyed by answer id (unique), and the route only checks that the *session* in the path is the
    caller's. B rating A's answer through B's own session must be refused: otherwise B's row squats the answer id and
    A can no longer rate their own answer (and B's rating counts in the admin's quality report)."""
    aid = _insert_answer(world.client, world.ids["s_ended"])
    r = world.call("PUT", f"/v1/sessions/{{b_session}}/answers/{aid}/feedback", world.b,
                   json={"rating": "down", "reason": "inaccurate"})
    owner = world.call("PUT", f"/v1/sessions/{{s_ended}}/answers/{aid}/feedback", world.a, json={"rating": "up"})
    assert owner.status_code == 200, f"A can't rate A's own answer after B's attempt: {owner.status_code} {owner.text}"
    assert r.status_code == 404, f"B rated A's answer through B's own session: {r.status_code} {r.text}"


@pytest.mark.parametrize("path", ["/v1/documents", "/v1/resumes", "/v1/workspaces", "/v1/stories", "/v1/answers",
                                  "/v1/sessions",
                                  "/v1/billing/upi/orders", "/v1/progress", "/v1/entitlements", "/v1/usage",
                                  "/v1/auth/me/export", "/v1/jobs/tracker", "/v1/jobs/profile", "/v1/jobs/feed"])
def test_lists_and_exports_hold_only_the_callers_own_objects(world: World, path: str) -> None:
    body = json.dumps(world.get(path, world.b))
    a_ids = [v for k, v in world.ids.items() if k in ("doc_resume", "doc_jd", "resume", "workspace", "story",
                                                      "s_ended", "s_open", "order", "answer", "question",
                                                      "job_entry", "saved_answer")]
    leaked = [i for i in a_ids if i in body]
    assert not leaked, f"{path} shows B ids of A's objects: {leaked}"
    assert world.ids["a_email"] not in body and world.ids["utr"] not in body


ORACLE_ROUTES = [
    ("GET", "/v1/documents/{}/text", {}), ("GET", "/v1/resumes/{}", {}), ("GET", "/v1/workspaces/{}", {}),
    ("PUT", "/v1/stories/{}", {"json": {"title": "x"}}), ("GET", "/v1/sessions/{}", {}),
    ("POST", "/v1/sessions/{}/companion", {}),
    ("POST", "/v1/billing/upi/orders/{}/utr", {"json": {"utr": "111122223333"}}),
    ("PATCH", "/v1/jobs/tracker/{}", {"json": {"notes": "x"}}), ("DELETE", "/v1/jobs/tracker/{}", {}),
]


@pytest.mark.parametrize(("method", "template", "kw"), ORACLE_ROUTES, ids=[f"{m} {t}" for m, t, _ in ORACLE_ROUTES])
def test_someone_elses_object_looks_exactly_like_a_missing_one(world: World, method: str, template: str,
                                                               kw: dict[str, Any]) -> None:
    key = {"/v1/documents": "doc_resume", "/v1/resumes": "resume", "/v1/workspaces": "workspace",
           "/v1/stories": "story", "/v1/sessions": "s_ended", "/v1/billing": "order", "/v1/jobs/tracker": "job_entry"}
    real = next(v for k, v in key.items() if template.startswith(k))
    if "companion" in template:
        real = "s_open"
    theirs = world.call(method, template.format("{" + real + "}"), world.b, **kw)
    missing = world.call(method, template.format(str(uuid.uuid4())), world.b, **kw)
    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())


# ---- every non-public route needs a session ------------------------------------------------------------------------

# Reachable without signing in, on purpose: health probes, sign-in/up and the emailed-link endpoints, the public price
# lists, Jobs AI's public numbers (counts only), the site-wide announcement banner, the desktop updater, the phone
# companion's redeem (the 256-bit share code is the credential), and the Contact page's form (it only adds a message).
PUBLIC: frozenset[tuple[str, str]] = frozenset({
    ("GET", "/health"), ("GET", "/ready"),
    ("GET", "/v1/auth/config"), ("POST", "/v1/auth/register"), ("POST", "/v1/auth/login"),
    ("POST", "/v1/auth/login/2fa"),  # before any session: the signed sign-in challenge is the credential
    ("POST", "/v1/auth/login/passkey/options"),  # a passkey sign-in starts signed out
    ("POST", "/v1/auth/login/passkey"),  # the passkey's signature over a single-use challenge is the credential
    ("POST", "/v1/auth/logout"), ("POST", "/v1/auth/verify-email/confirm"),
    ("POST", "/v1/auth/password-reset/request"), ("POST", "/v1/auth/password-reset/confirm"),
    ("POST", "/v1/auth/email-change/confirm"),
    ("GET", "/v1/plans"), ("GET", "/v1/billing/packs"),
    ("GET", "/v1/billing/monthly"), ("GET", "/v1/jobs/stats"), ("GET", "/v1/announcement"),
    # The visitor's country from the web app's edge, for signed-out wording (nothing stored, no cookie).
    ("GET", "/v1/region"),
    # The Technical details page's latency aggregates (nothing per person; empty until enough sessions).
    ("GET", "/v1/public/engineering-telemetry"),
    ("GET", "/v1/desktop/update/{target}/{arch}/{current_version}"),
    ("GET", "/v1/desktop/download/{version}/{filename}"),
    ("POST", "/v1/companion/redeem"), ("POST", "/v1/companion/{code}"),
    ("POST", "/v1/contact"),
    # Razorpay's webhook: no session, it's authenticated by Razorpay's signature (tests/test_razorpay.py).
    ("POST", "/v1/billing/webhook"),
    # PayPal's: believed only when PayPal's verify-webhook-signature says so (tests/test_paypal.py).
    ("POST", "/v1/billing/paypal/webhook"),
    # The job alert email's "stop these emails" link: the stored random token (in the body) is the credential, and
    # all it can do is turn that one person's alerts off.
    ("POST", "/v1/jobs/alerts/off"),
    # Google sign-in: the redirect out and back, before anyone is signed in (the state cookie guards the return).
    ("GET", "/v1/auth/google/start"), ("GET", "/v1/auth/google/callback"),
    # The desktop app's Google sign-in (D81): the loopback code and its PKCE verifier are the credential.
    ("POST", "/v1/auth/desktop/exchange"),
    # What an invite link's code gives, for the sign-up page (a creator's or campus's label at most, never an
    # inviter's name).
    ("GET", "/v1/referrals/codes/{code}"),
    # The support chat works signed out: the thread's 256-bit token (in the body) is the credential.
    ("POST", "/v1/support/threads"), ("GET", "/v1/support/threads/{thread_id}"),
    ("POST", "/v1/support/threads/{thread_id}/messages"), ("POST", "/v1/support/threads/{thread_id}/handoff"),
    ("DELETE", "/v1/support/threads/{thread_id}"),
    # Orbit Apply's tailored resume for the executor: the 15-minute HMAC link (exp + sig) is the credential.
    ("GET", "/v1/apply/{packet_id}/resume.pdf"),
    # Orbit for Business (D82): the careers pages, their sitemap and a company's logo are public by design; applying
    # and reporting a job work signed out (rate-limited, the bot check when configured); an invite's lookup shows
    # only the company and a masked address; the applicant's high-entropy emailed link is its own credential.
    ("GET", "/v1/public/business/companies/{slug}"), ("GET", "/v1/public/business/companies/{slug}/jobs/{job_slug}"),
    ("GET", "/v1/public/business/companies/{slug}/logo"), ("GET", "/v1/public/business/sitemap"),
    ("POST", "/v1/public/business/jobs/{job_id}/apply"), ("POST", "/v1/public/business/jobs/{job_id}/report"),
    ("GET", "/v1/public/business/invites/{token}"),
    ("GET", "/v1/public/business/applications/{token}"),
    ("POST", "/v1/public/business/applications/{token}/confirm"),
    ("POST", "/v1/public/business/applications/{token}/book"),
    ("POST", "/v1/public/business/applications/{token}/delete-request"),
    # Hiring Studio uses that same application-token boundary (tested with missing/deleted tokens and valid bodies).
    ("GET", "/v1/public/business/applications/{token}/work-sample"),
    ("POST", "/v1/public/business/applications/{token}/work-sample"),
    ("POST", "/v1/public/business/applications/{token}/clarification"),
    ("GET", "/v1/public/business/applications/{token}/calendar.ics"),
    ("GET", "/v1/public/business/applications/{token}/conversation"),
    ("GET", "/v1/public/business/applications/{token}/saba"),
    ("POST", "/v1/public/business/applications/{token}/saba/start"),
    ("POST", "/v1/public/business/applications/{token}/saba/answers"),
    ("POST", "/v1/public/business/applications/{token}/saba/alternative"),
    ("POST", "/v1/public/business/applications/{token}/saba/explanation"),
    ("POST", "/v1/public/business/applications/{token}/saba/speech"),
    ("POST", "/v1/public/business/applications/{token}/saba/network-check"),
    ("POST", "/v1/public/business/applications/{token}/saba/stop-country-sharing"),
    ("GET", "/v1/public/business/applications/{token}/offer"),
    ("POST", "/v1/public/business/applications/{token}/offer/respond"),
})


def _flatten(routes: list[Any], prefix: str = "") -> Iterator[tuple[str, APIRoute]]:
    """Every APIRoute with its full path. Newer FastAPI keeps included routers as lazy `_IncludedRouter` entries
    (`original_router` + `include_context.prefix`) instead of copying their routes into `app.routes`."""
    for r in routes:
        if isinstance(r, APIRoute):
            yield (prefix + r.path, r)
        elif (inner := getattr(r, "original_router", None)) is not None:
            yield from _flatten(inner.routes, prefix + getattr(getattr(r, "include_context", None), "prefix", ""))


def _http_routes() -> list[tuple[str, str]]:
    from orbit_api.main import create_app

    return sorted({(m, path) for path, r in _flatten(create_app().routes) for m in r.methods})


ROUTES = _http_routes()
PROTECTED = [r for r in ROUTES if r not in PUBLIC]
PATH_PARAMS = {"doc_id": "doc_resume", "resume_id": "resume", "workspace_id": "workspace", "story_id": "story",
               "session_id": "s_ended", "answer_id": "answer", "order_id": "order", "payment_id": "order",
               "user_id": "a_id", "listing_id": "listing", "entry_id": "job_entry", "message_id": "a_message"}


def test_route_inventory_is_complete() -> None:
    assert not PUBLIC - set(ROUTES), f"stale PUBLIC entries: {sorted(PUBLIC - set(ROUTES))}"
    assert len(PROTECTED) >= 70, len(PROTECTED)  # every route is classified one way or the other


def _concrete(path: str) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: "{" + PATH_PARAMS.get(m.group(1), m.group(1)) + "}", path)


@pytest.mark.parametrize(("method", "path"), PROTECTED, ids=[f"{m} {p}" for m, p in PROTECTED])
def test_protected_route_refuses_anonymous_callers(world: World, method: str, path: str) -> None:
    r = world.call(method, _concrete(path), None)
    assert r.status_code == 401, f"{method} {path} answered {r.status_code} without a session: {r.text[:200]}"


@pytest.mark.parametrize(("method", "path"), PROTECTED, ids=[f"{m} {p}" for m, p in PROTECTED])
def test_protected_route_refuses_a_garbage_token(world: World, method: str, path: str) -> None:
    r = world.call(method, _concrete(path), {"Authorization": "Bearer not.a.token"})
    assert r.status_code == 401, f"{method} {path} answered {r.status_code} to a garbage token"


def test_anonymous_writes_change_nothing(world: World) -> None:
    before = _owner_view(world)
    for method, path in PROTECTED:
        if method != "GET":
            assert world.call(method, _concrete(path), None).status_code == 401
    assert _owner_view(world) == before


@pytest.mark.parametrize("path", ["/v1/sessions/{s_open}/live", "/v1/sessions/{s_open}/view"])
def test_websockets_refuse_connections_without_a_ticket(world: World, path: str) -> None:
    url = _fill(path, world.ids)
    assert _ws_close_code(world.client, url) == 4001
    assert _ws_close_code(world.client, url + "?ticket=forged") == 4001


# ---- the admin wall ------------------------------------------------------------------------------------------------

ADMIN_ROUTES: list[tuple[str, str, dict[str, Any]]] = [
    ("GET", "/v1/admin/config", {}),
    ("PUT", "/v1/admin/config", {"json": {}}),
    ("GET", "/v1/admin/latency", {}),
    ("GET", "/v1/admin/providers", {}),
    ("GET", "/v1/admin/feedback", {}),
    ("GET", "/v1/admin/costs", {}),
    ("GET", "/v1/admin/users", {}),
    ("GET", "/v1/admin/users?only=pending&q=idor", {}),
    ("GET", "/v1/admin/users/{target}/activity", {}),
    ("POST", "/v1/admin/users/{target}/access", {"json": {"action": "grant", "plan": "unlimited", "hours": 2}}),
    ("POST", "/v1/admin/users/{target}/access", {"json": {"action": "approve"}}),
    ("POST", "/v1/admin/users/{target}/credits", {"json": {"resume": 5, "interview_minutes": 30}}),
    ("GET", "/v1/admin/users/{target}", {}),
    ("PATCH", "/v1/admin/users/{target}", {"json": {"name": "Mallory", "admin_note": "idor"}}),
    ("POST", "/v1/admin/users/{target}/credits/remove", {"json": {"all_resume": True, "reason": "idor check"}}),
    ("POST", "/v1/admin/users/bulk-credits", {"json": {"user_ids": ["{target}"], "resume": 5}}),
    ("POST", "/v1/admin/users/{target}/sign-out", {}),
    ("POST", "/v1/admin/users/{target}/password-reset", {}),
    ("POST", "/v1/admin/users/{target}/2fa/off", {"json": {"reason": "idor check, matched ID"}}),
    ("POST", "/v1/admin/users/{target}/suspend", {"json": {"reason": "idor check"}}),
    ("POST", "/v1/admin/users/{target}/unsuspend", {}),
    ("DELETE", "/v1/admin/users/{target}", {"json": {"confirm_email": "{target_email}"}}),
    ("GET", "/v1/admin/users/export", {}),
    ("GET", "/v1/admin/users/export?only=paid&q=idor", {}),
    ("GET", "/v1/admin/audit", {}),
    ("GET", "/v1/admin/audit?scope=all&user_id={target}", {}),
    ("GET", "/v1/admin/stats", {}),
    ("GET", "/v1/admin/payments", {}),
    ("GET", "/v1/admin/payments?only=all", {}),
    ("POST", "/v1/admin/payments/{target_order}", {"json": {"action": "approve"}}),
    ("POST", "/v1/admin/payments/{target_order}", {"json": {"action": "reject", "note": "no such payment"}}),
    ("GET", "/v1/admin/inbox", {}),
    ("GET", "/v1/admin/inbox?status=all&topic=payment&q=idor", {}),
    ("GET", "/v1/admin/inbox/{target_message}", {}),
    ("PATCH", "/v1/admin/inbox/{target_message}", {"json": {"status": "done", "admin_note": "idor"}}),
    ("POST", "/v1/admin/inbox/{target_message}/reply", {"json": {"text": "idor check"}}),
    ("DELETE", "/v1/admin/inbox/{target_message}", {}),
    ("GET", "/v1/admin/support", {}),
    ("GET", "/v1/admin/support?only=all", {}),
    ("GET", "/v1/admin/support/{target_thread}", {}),
    ("POST", "/v1/admin/support/{target_thread}/reply", {"json": {"text": "idor check"}}),
    ("POST", "/v1/admin/support/{target_thread}/close", {}),
    ("DELETE", "/v1/admin/support/{target_thread}", {}),
    ("POST", "/v1/admin/payments/reconcile", {}),
    ("GET", "/v1/admin/referrals", {}),
    ("GET", "/v1/admin/referrals/export", {}),
    ("POST", "/v1/admin/referrals/codes", {"json": {"code": "I{target_code_tag}", "label": "x", "kind": "campus"}}),
    ("PATCH", "/v1/admin/referrals/codes/{target_code}", {"json": {"active": False}}),
    ("GET", "/v1/admin/apply/sites", {}),
    ("PUT", "/v1/admin/apply/sites/lever", {"json": {"paused": False}}),
    # Orbit for Business's review (D82): refused before any lookup, so ids that don't exist are enough.
    ("GET", "/v1/admin/business/companies", {}),
    ("GET", "/v1/admin/business/companies/{company_id}", {}),
    ("POST", "/v1/admin/business/companies/{company_id}/suspend", {"json": {"reason": "idor check"}}),
    ("POST", "/v1/admin/business/companies/{company_id}/unsuspend", {}),
    ("POST", "/v1/admin/business/companies/{company_id}/verify", {}),
    ("POST", "/v1/admin/business/companies/{company_id}/plan", {"json": {"plan": "growth"}}),
    ("POST", "/v1/admin/business/jobs/{job_id}/take-down", {"json": {"reason": "idor check"}}),
    ("POST", "/v1/admin/business/jobs/{job_id}/restore", {}),
    ("GET", "/v1/admin/business/companies/{company_id}/audit", {}),
    ("GET", "/v1/admin/business/reports", {}),
    ("POST", "/v1/admin/business/reports/{report_id}", {"json": {"status": "dismissed"}}),
]
ADMIN_IDS = [f"{m} {p} {json.dumps(k.get('json', ''))[:40]}" for m, p, k in ADMIN_ROUTES]


def test_admin_route_inventory_is_complete() -> None:
    admin = {p for _, p in ROUTES if p.startswith("/v1/admin/")} - {"/v1/admin/status"}
    covered = {p.split("?", 1)[0].replace("{target}", "{user_id}").replace("{target_order}", "{payment_id}")
               .replace("{target_message}", "{message_id}").replace("{target_thread}", "{thread_id}")
               .replace("{target_code}", "{code_id}").replace("/apply/sites/lever", "/apply/sites/{site}")
               for _, p, _ in ADMIN_ROUTES}
    assert admin <= covered, f"admin routes missing from the matrix: {sorted(admin - covered)}"


@pytest.mark.parametrize(("method", "path", "kw"), ADMIN_ROUTES, ids=ADMIN_IDS)
def test_admin_routes_refuse_a_normal_user(world: World, method: str, path: str, kw: dict[str, Any]) -> None:
    ids = {**world.ids, "target": world.ids["a_id"], "target_email": world.ids["a_email"],
           "target_order": world.ids["order"], "target_message": world.ids["a_message"]}
    before = _owner_view(world)
    world.client.cookies.clear()
    r = world.client.request(method, _fill(path, ids), headers=world.b, **_fill(kw, ids))
    assert r.status_code == 403, f"a normal user got {r.status_code}: {r.text[:200]}"
    assert world.ids["a_email"] not in r.text
    assert _owner_view(world) == before  # A's plan, credits and payment are untouched


@pytest.mark.parametrize(("method", "path", "kw"), ADMIN_ROUTES, ids=ADMIN_IDS)
def test_admin_routes_refuse_anonymous_callers(world: World, method: str, path: str, kw: dict[str, Any]) -> None:
    ids = {**world.ids, "target": world.ids["a_id"], "target_email": world.ids["a_email"],
           "target_order": world.ids["order"], "target_message": world.ids["a_message"]}
    world.client.cookies.clear()
    assert world.client.request(method, _fill(path, ids), **_fill(kw, ids)).status_code == 401


@pytest.mark.parametrize(("method", "path", "kw"), ADMIN_ROUTES, ids=ADMIN_IDS)
def test_admin_routes_work_for_the_admin(world: World, method: str, path: str, kw: dict[str, Any]) -> None:
    # A throwaway target, so the admin's changes never touch A's objects.
    c = world.client
    h, user = _signup(c, _email("target"))
    order = _created(c.post("/v1/billing/upi/orders", headers=h, json={"pack": "starter"}))
    assert c.post(f"/v1/billing/upi/orders/{order}/utr", headers=h,
                  json={"utr": f"{uuid.uuid4().int % 10**12:012d}"}).status_code == 200
    sent = c.post("/v1/contact", headers=h, json={"name": "Target", "email": user["email"], "topic": "other",
                                                  "message": "A message for the admin's wall."})
    assert sent.status_code == 201, sent.text
    message = c.get("/v1/admin/inbox", headers=world.admin, params={"q": sent.json()["reference"],
                                                                    "status": "all"}).json()["items"][0]["id"]
    thread = _created(c.post("/v1/support/threads", headers=h))
    tag = uuid.uuid4().hex[:8].upper()
    code = _created(c.post("/v1/admin/referrals/codes", headers=world.admin,
                           json={"code": f"T{tag}", "label": "target", "kind": "creator"}))
    ids = {"target": user["id"], "target_email": user["email"], "target_order": order, "target_message": message,
           "target_thread": thread, "target_code": code, "target_code_tag": tag}
    if "/v1/admin/business/" in path:  # a throwaway company with a published, reported job
        comp = _created(c.post("/v1/business/companies", headers=h, json={
            "name": "Target Co", "website": f"target-{tag.lower()}.com", "size": "1-10", "country": "IN"}))
        assert c.post(f"/v1/admin/business/companies/{comp}/verify", headers=world.admin).status_code == 200
        job = _created(c.post(f"/v1/business/companies/{comp}/jobs", headers=h, json={
            "title": "Target role", "locations": ["Pune"],
            "description_html": "<p>A role that exists only for the admin wall's check, long enough to publish.</p>"}))
        assert c.post(f"/v1/business/companies/{comp}/jobs/{job}/publish", headers=h).status_code == 200
        assert c.post(f"/v1/public/business/jobs/{job}/report", json={"reason": "other"}).status_code == 201
        reports = c.get("/v1/admin/business/reports", headers=world.admin).json()
        ids.update(company_id=comp, job_id=job, report_id=next(r["id"] for r in reports if r["job_id"] == job))
    if path.endswith("/2fa/off"):  # only for an account that has two-step sign-in on
        from tests.test_two_factor import _turn_on

        _turn_on(c, h)  # confirms with the shared test password (PW)
    c.cookies.clear()
    r = c.request(method, _fill(path, ids), headers=world.admin, **_fill(kw, ids))
    # 201: a code made · 202: an email on its way · 204: deleted
    assert r.status_code in (200, 201, 202, 204), r.text


def test_admin_status_says_who_is_admin_without_a_403(world: World) -> None:
    assert world.get("/v1/admin/status", world.b) == {"is_admin": False}
    assert world.get("/v1/admin/status", world.a) == {"is_admin": False}
    assert world.get("/v1/admin/status", world.admin) == {"is_admin": True}
    assert world.call("GET", "/v1/admin/status", None).status_code == 401


# ---- mass assignment -----------------------------------------------------------------------------------------------

PRIVILEGED = {"is_admin": True, "admin": True, "approved": True, "email_verified": True, "plan": "unlimited",
              "grant_plan": "unlimited", "grant_until": "2099-01-01T00:00:00Z", "credits": 1000,
              "resume_credits": 1000, "token_version": 7, "status": "approved", "amount_inr": 1, "role": "admin"}


def test_sign_up_ignores_privileged_fields(world: World) -> None:
    c = world.client
    h, user = _signup(c, _email("mass"), **PRIVILEGED, user_id=world.ids["a_id"], id=world.ids["a_id"])
    assert user["id"] != world.ids["a_id"]
    assert user["email_verified"] is False and user["approval_pending"] is True
    assert world.get("/v1/auth/me", h)["id"] == user["id"]  # the token works: "token_version": 7 wasn't stored
    assert world.get("/v1/admin/status", h) == {"is_admin": False}
    assert world.get("/v1/entitlements", h)["plan"] == "pending"
    blocked = c.post("/v1/sessions", headers=h, json={"title": "x"})
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "approval_pending"
    row = next(u for u in world.get("/v1/admin/users?only=pending", world.admin)["users"] if u["id"] == user["id"])
    assert row["access"] == "pending" and row["resume_credits"] == 1 and row["grant_until"] is None


def test_privacy_update_changes_only_the_privacy_flag(world: World) -> None:
    h, user = _signup(world.client, _email("privacy"), name="Pat")
    r = world.call("PATCH", "/v1/auth/me/privacy", h, json={
        "store_transcripts": False, **PRIVILEGED, "email": "evil@example.com", "name": "pwned",
        "id": world.ids["a_id"], "password_hash": "x", "store_screenshots": True})
    assert r.status_code == 200, r.text
    me = world.get("/v1/auth/me", h)  # the same token still works (token_version unchanged)
    assert me["store_transcripts"] is False and me["store_screenshots"] is False
    assert (me["id"], me["email"], me["name"], me["email_verified"]) == (user["id"], user["email"], "Pat", False)
    assert me["approval_pending"] is True and world.get("/v1/admin/status", h) == {"is_admin": False}
    login = world.client.post("/v1/auth/login", json={"email": user["email"], "password": PW})
    assert login.status_code == 200  # "password_hash" in the body didn't replace the password


CREATES: list[tuple[str, dict[str, Any], str]] = [
    ("/v1/resumes", {"title": "Bob's CV", "data": strong_resume().model_dump(mode="json")}, "/v1/resumes"),
    ("/v1/workspaces", {"name": "Bob's other setup"}, "/v1/workspaces"),
    ("/v1/stories", {"title": "Bob's story"}, "/v1/stories"),
    ("/v1/sessions", {"title": "Bob's mock"}, "/v1/sessions"),
    ("/v1/documents/text", {"title": "Bob's notes", "kind": "notes", "text": "Notes about the Kafka migration."},
     "/v1/documents"),
]


@pytest.mark.parametrize(("path", "body", "listing"), CREATES, ids=[p for p, _, _ in CREATES])
def test_created_objects_always_belong_to_the_caller(world: World, path: str, body: dict[str, Any],
                                                     listing: str) -> None:
    forged = {"user_id": world.ids["a_id"], "owner_id": world.ids["a_id"], "id": "attacker-chosen-id",
              "created_at": "2000-01-01T00:00:00Z", "updated_at": "2000-01-01T00:00:00Z"}
    before = _owner_view(world)
    r = world.call("POST", path, world.b, json={**body, **forged})
    new_id = _created(r)
    assert new_id != "attacker-chosen-id" and not str(r.json()["created_at"]).startswith("2000")
    assert new_id in {x["id"] for x in world.get(listing, world.b)}
    assert new_id not in json.dumps(world.get(listing, world.a))
    assert _owner_view(world) == before
    world.call("DELETE", f"{listing}/{new_id}", world.b)  # keep B's document quota free


def test_a_new_version_of_a_document_cannot_replace_someone_elses(world: World) -> None:
    """"Use in Orbit" sends the id of the document it made before, to update it in place. Naming A's document must
    neither touch it nor say whether it exists: B just gets a new document of their own."""
    before = _owner_view(world)
    r = world.call("POST", "/v1/documents/text", world.b, json={
        "title": "Bob's CV", "kind": "resume", "text": "pwned by bob " * 5, "replace_id": "{doc_resume}"})
    new_id = _created(r)
    assert r.status_code == 201 and new_id != world.ids["doc_resume"]
    assert _owner_view(world) == before
    assert new_id in {d["id"] for d in world.get("/v1/documents", world.b)}
    world.call("DELETE", f"/v1/documents/{new_id}", world.b)  # keep B's document quota free


def test_resume_update_cannot_move_it_to_another_account(world: World) -> None:
    rid = _created(world.call("POST", "/v1/resumes", world.b, json={"title": "Bob's CV"}))
    r = world.call("PUT", f"/v1/resumes/{rid}", world.b, json={"title": "Bob's CV v2", "user_id": world.ids["a_id"],
                                                               "id": world.ids["resume"]})
    assert r.status_code == 200 and r.json()["id"] == rid
    assert world.get(f"/v1/resumes/{rid}", world.b)["title"] == "Bob's CV v2"
    assert world.get("/v1/resumes/{resume}", world.a)["title"] == "Alice's CV"
    assert rid not in json.dumps(world.get("/v1/resumes", world.a))
    world.call("DELETE", f"/v1/resumes/{rid}", world.b)


def test_session_create_ignores_server_side_fields(world: World) -> None:
    r = world.call("POST", "/v1/sessions", world.b, json={
        "title": "Bob's interview", "user_id": world.ids["a_id"], "id": "attacker-chosen-id", "status": "ended",
        "duration_s": 99_999, "duration_seconds": 99_999, "started_at": "2000-01-01T00:00:00Z",
        "ended_at": "2000-01-01T00:00:00Z", "rolling_summary": "INJECTED", "metrics": {"x": [1]},
        "report_status": "ready", "question_count": 50, "language": "fr", "answer_language": "fr"})
    s = r.json()
    assert r.status_code == 201 and s["id"] != "attacker-chosen-id"
    assert (s["status"], s["duration_seconds"], s["started_at"], s["ended_at"]) == ("created", 0, None, None)
    # The interview language is the client's own choice (live_language.py); an answer language that's the same is
    # stored as none ("same as the interview").
    assert (s["question_count"], s["report_status"], s["language"], s["answer_language"]) == (0, None, "fr", None)
    assert s["id"] not in json.dumps(world.get("/v1/sessions", world.a))
    world.call("DELETE", f"/v1/sessions/{s['id']}", world.b)


def test_upi_order_and_utr_ignore_amount_status_and_credit_fields(world: World) -> None:
    c, admin = world.client, world.admin
    h, user = _signup(c, _email("buyer"))
    before = world.get("/v1/admin/users?q=" + user["email"], admin)["users"][0]
    order = world.call("POST", "/v1/billing/upi/orders", h, json={
        "pack": "starter", "amount_inr": 1, "price_inr": 1, "status": "approved", "resume_credits": 9_999,
        "interview_minutes": 9_999, "days": 3_650, "user_id": world.ids["a_id"], "reference": "ORBHACK",
        "utr": "123123123123", "decided_at": "2000-01-01T00:00:00Z"})
    assert order.status_code == 201, order.text
    o = order.json()
    assert (o["amount_inr"], o["resume_credits"], o["interview_minutes"]) == (2599, 30, 180)
    assert o["status"] == "awaiting_payment" and o["utr"] is None and o["reference"] != "ORBHACK"
    assert o["decided_at"] is None

    utr = f"{uuid.uuid4().int % 10**12:012d}"
    sent = world.call("POST", f"/v1/billing/upi/orders/{o['id']}/utr", h, json={
        "utr": utr, "status": "approved", "amount_inr": 1, "note": "auto-approved", "user_id": world.ids["a_id"],
        "resume_credits": 9_999, "decided_at": "2000-01-01T00:00:00Z"})
    assert sent.status_code == 200, sent.text
    s = sent.json()
    assert (s["status"], s["amount_inr"], s["note"], s["decided_at"], s["utr"]) == ("submitted", 2599, None, None, utr)
    after = world.get("/v1/admin/users?q=" + user["email"], admin)["users"][0]
    assert (after["resume_credits"], after["interview_minutes_left"]) == (before["resume_credits"],
                                                                          before["interview_minutes_left"])
    row = next(p for p in world.get("/v1/admin/payments", admin)["payments"] if p["id"] == o["id"])
    assert row["user_id"] == user["id"] and row["amount_inr"] == 2599 and row["status"] == "submitted"
    assert o["id"] not in json.dumps(world.get("/v1/billing/upi/orders", world.a))


# ---- live WebSocket tickets ------------------------------------------------------------------------------------------


def _ticket(w: World, who: dict[str, str], session_id: str) -> str:
    r = w.call("POST", f"/v1/sessions/{session_id}/live-ticket", who)
    assert r.status_code == 200, r.text
    return str(r.json()["ticket"])


def test_a_live_ticket_only_opens_the_session_it_was_issued_for(world: World) -> None:
    sid = _created(world.call("POST", "/v1/sessions", world.a, json={"title": "ticket binding"}))
    ticket = _ticket(world, world.a, sid)
    # A's ticket on B's session: refused, and the attempt spends it (it can't be replayed on A's own either)
    assert _ws_close_code(world.client, f"/v1/sessions/{world.ids['b_session']}/live?ticket={ticket}") == 4001
    assert _ws_close_code(world.client, f"/v1/sessions/{sid}/live?ticket={ticket}") == 4001
    # B's ticket for B's own session doesn't open A's
    b_ticket = _ticket(world, world.b, world.ids["b_session"])
    assert _ws_close_code(world.client, f"/v1/sessions/{sid}/live?ticket={b_ticket}") == 4001
    assert world.get(f"/v1/sessions/{sid}", world.a)["session"]["status"] == "created"  # never went live
    world.call("DELETE", f"/v1/sessions/{sid}", world.a)


def test_a_ticket_minted_for_the_wrong_owner_is_refused_at_the_socket(world: World) -> None:
    from orbit_api.auth.security import issue_ticket

    forged = issue_ticket(world.ids["b_id"], world.ids["s_open"])  # B's user id bound to A's session
    assert _ws_close_code(world.client, f"/v1/sessions/{world.ids['s_open']}/live?ticket={forged}") == 4004
    assert world.get("/v1/sessions/{s_open}", world.a)["session"]["status"] != "live"


def test_a_live_ticket_is_single_use_and_expires(world: World) -> None:
    from orbit_api.auth import security

    sid = _created(world.call("POST", "/v1/sessions", world.a, json={"title": "single use"}))
    ticket = _ticket(world, world.a, sid)
    with world.client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
    assert _ws_close_code(world.client, f"/v1/sessions/{sid}/live?ticket={ticket}") == 4001  # replay

    stale = _ticket(world, world.a, sid)
    security._tickets[stale].expires_at = 0.0  # past its 60 s
    assert _ws_close_code(world.client, f"/v1/sessions/{sid}/live?ticket={stale}") == 4001
    assert world.call("POST", f"/v1/sessions/{sid}/end", world.a).status_code == 200
    assert world.call("POST", f"/v1/sessions/{sid}/live-ticket", world.a).status_code == 409  # ended: no new ones


def test_phone_view_tickets_and_live_tickets_are_not_interchangeable(world: World) -> None:
    sid = _created(world.call("POST", "/v1/sessions", world.a, json={"title": "two kinds of ticket"}))
    code = world.call("POST", f"/v1/sessions/{sid}/companion", world.a).json()["code"]
    world.client.cookies.clear()
    view = world.client.post("/v1/companion/redeem", json={"code": code}).json()["ticket"]
    # the phone's read-only ticket can't open the session's live (audio in, answers out) socket
    assert _ws_close_code(world.client, f"/v1/sessions/{sid}/live?ticket={view}") == 4001
    live = _ticket(world, world.a, sid)
    assert _ws_close_code(world.client, f"/v1/sessions/{sid}/view?ticket={live}") == 4001
    # and a phone ticket for A's session doesn't open B's
    view2 = world.client.post("/v1/companion/redeem", json={"code": code}).json()["ticket"]
    assert _ws_close_code(world.client, f"/v1/sessions/{world.ids['b_session']}/view?ticket={view2}") == 4001
    assert world.call("POST", f"/v1/sessions/{sid}/end", world.a).status_code == 200


def test_deleting_a_session_revokes_its_phone_share_code(world: World) -> None:
    """Ending a session revokes its share code; deleting it must too, or whoever holds the code keeps getting view
    tickets (and any replay buffer) for a session that no longer exists, for up to 4 hours."""
    sid = _created(world.call("POST", "/v1/sessions", world.a, json={"title": "deleted while shared"}))
    code = world.call("POST", f"/v1/sessions/{sid}/companion", world.a).json()["code"]
    assert world.call("DELETE", f"/v1/sessions/{sid}", world.a).status_code == 204
    r = world.call("POST", "/v1/companion/redeem", None, json={"code": code})
    companion.stop_sharing(sid)  # don't leave it behind for the rest of the module
    assert r.status_code == 404, f"the share code of a deleted session still redeems: {r.status_code} {r.text}"
