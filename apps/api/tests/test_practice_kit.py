"""The written-round and guesstimate reviews (orbit_api/practice_kit.py)."""
from fastapi.testclient import TestClient

from tests.test_api import _register
from tests.test_job_alerts import _me, _verify

EMAIL = ("Hi team, i am writing to inform that the wifi in the hostel is not working since monday. Please fix it "
         "soon. Thanks, Ravi")


def _user(client: TestClient) -> dict[str, str]:
    h = _register(client)
    _verify(client, _me(client, h)["id"])
    return h


def test_a_written_answer_gets_scores_and_fixes_that_quote_only_its_own_words(client: TestClient) -> None:
    h = _user(client)
    r = client.post("/v1/practice/written-review", headers=h, json={
        "kind": "email", "brief": "Write to the hostel warden: the Wi-Fi is down. Ask for a date it will be fixed.",
        "text": EMAIL})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["total"] == sum(out["scores"].values()) == 14 and out["words"] == len(EMAIL.split())
    assert [f["quote"] for f in out["fixes"]] == ["Hi team, i am"]  # the made-up quote is dropped
    assert out["missed"] and out["strengths"]


def test_a_guesstimate_review_keeps_only_assumptions_the_candidate_wrote(client: TestClient) -> None:
    h = _user(client)
    r = client.post("/v1/practice/guesstimate-review", headers=h, json={
        "question": "How many cups of tea are sold in Bengaluru in a day?",
        "clarify": "Only roadside stalls and cafes, not homes.",
        "approach": "People who drink tea outside x cups per person.",
        "assumptions": "Population 1.4 crore; 30% drink tea outside; 1.5 cups each.",
        "calculation": "1.4 crore x 0.3 x 1.5 = 63 lakh", "answer": "About 60 lakh cups", "sanity": ""})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["total"] == sum(out["scores"].values()) == 17
    assert [a["quote"] for a in out["assumptions"]] == ["Population 1.4 crore; 30%"]
    assert out["math_ok"] is True and out["follow_ups"]


def test_reviews_need_an_account_and_real_input(client: TestClient) -> None:
    body = {"kind": "essay", "brief": "Should college attendance be optional?", "text": "Attendance " * 30}
    assert client.post("/v1/practice/written-review", json=body).status_code == 401
    v = _user(client)
    assert client.post("/v1/practice/written-review", headers=v, json={**body, "text": "short"}).status_code == 422
    assert client.post("/v1/practice/guesstimate-review", headers=v, json={"question": "?"}).status_code == 422
