from datetime import UTC, datetime, timedelta

import pytest

from orbit_api.job_portal.ranking import Row, Search, rank
from orbit_api.job_portal.signals import posting_check, relocation_of, visa_of
from orbit_api.job_portal.skills import SkillMatcher

NOW = datetime(2026, 10, 15, tzinfo=UTC)


@pytest.mark.parametrize("text", [
    "Unfortunately we are unable to offer visa sponsorship for this role.",
    "We do not sponsor work visas.",
    "Candidates must be authorized to work in the US without the need for current or future sponsorship.",
    "No sponsorship available.",
    "Visa sponsorship is not available for this position.",
    "This role is not eligible for visa sponsorship.",
    "We can't provide H-1B sponsorship.",
])
def test_reads_no_sponsorship(text: str) -> None:
    assert visa_of(f"Backend engineer. {text} Apply now.") == "not_offered"


@pytest.mark.parametrize("text", [
    "Visa sponsorship is available for the right candidate.",
    "We sponsor visas and offer relocation support.",
    "We can provide visa sponsorship to Germany.",
    "Our package includes visa sponsorship and a relocation bonus.",
    "H-1B sponsorship for qualified candidates.",
])
def test_reads_sponsorship(text: str) -> None:
    assert visa_of(text) == "offered"


def test_says_nothing_when_the_post_does_not() -> None:
    assert visa_of("Python, Postgres, 3+ years. Hybrid in Pune.") is None
    assert visa_of("Visa card payments experience preferred.") is None  # the card, not the permit
    assert not relocation_of("Python, Postgres. Pune.")


def test_relocation() -> None:
    assert relocation_of("We offer a relocation package to Amsterdam.")
    assert relocation_of("Relocation assistance is provided.")
    assert relocation_of("We'll help you relocate to Berlin.")
    assert not relocation_of("No relocation assistance is offered.")
    assert not relocation_of("Relocation is not available for this role.")


def _check(**kw: object) -> list[str]:
    args: dict[str, object] = dict(title="Backend Engineer", description="Build payments. " * 40, salary=None,
                                   posted_at=NOW - timedelta(days=2), first_seen_at=NOW - timedelta(days=2),
                                   earliest_elsewhere=None, still_listed_at=None, direct=True, full_text=True, now=NOW)
    args.update(kw)
    return [s.kind for s in posting_check(**args)]  # type: ignore[arg-type]


def test_a_fresh_post_on_the_careers_page() -> None:
    kinds = _check(still_listed_at=NOW, salary="₹20-30 LPA")
    assert kinds == ["listed", "pay", "fresh"]


def test_old_redated_and_seen_elsewhere_come_first() -> None:
    kinds = _check(posted_at=NOW - timedelta(days=1), first_seen_at=NOW - timedelta(days=25),
                   earliest_elsewhere=NOW - timedelta(days=60))
    assert kinds[:3] == ["old", "redated", "earlier"]
    assert "fresh" not in kinds
    assert "no_pay" in kinds


def test_evergreen_wording_and_pipeline_titles() -> None:
    assert "evergreen" in _check(description="We're always looking for great engineers to join our talent pool.")
    assert "evergreen" in _check(title="General Application - Engineering")
    # A snippet isn't the whole post: no "no pay range" from a snippet that can't show one.
    assert "no_pay" not in _check(full_text=False)


def test_a_board_post_says_to_check_the_careers_page() -> None:
    assert "not_direct" in _check(direct=False)
    assert "not_direct" not in _check(direct=True)


def test_needs_sponsorship_hides_posts_that_say_no() -> None:
    def row(i: str, visa: str | None) -> Row:
        return Row(id=i, source="greenhouse", company="Acme", title="Backend Engineer", cities=("Bengaluru",),
                   country="IN", remote_scope=(), workplace="onsite", employment_type="full_time", level=None,
                   exp_min=None, exp_max=None, posted_at=NOW, keywords=(), dedupe_key=f"acme|{i}", visa=visa)
    rows = [row("a", None), row("b", "not_offered"), row("c", "offered")]
    search = Search(titles=["Backend Engineer"], skills=[], locations=[], workplace=[], level=None, years=None,
                    job_types=[], days=30)
    assert {m.id for m in rank(rows, search, SkillMatcher("", []), now=NOW)} == {"a", "b", "c"}
    search.needs_sponsorship = True
    assert {m.id for m in rank(rows, search, SkillMatcher("", []), now=NOW)} == {"a", "c"}
