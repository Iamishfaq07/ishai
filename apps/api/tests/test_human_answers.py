"""The spoken answer sounds like a person: the prompt asks for it (live_system.md, "HOW IT SOUNDS"), and the
mechanical tells the model still slips in are cleaned as the answer streams (answer_format.humanize)."""

from orbit_api.live.answer_format import AnswerStreamParser, humanize
from orbit_api.live.context_builder import live_system_prompt
from orbit_api.live.events import QuestionType


def test_dashes_become_pauses_but_ranges_stay() -> None:
    assert humanize("I moved security left — I built SAST gates.") == "I moved security left, I built SAST gates."
    assert humanize("That's the gap – the fix is small.") == "That's the gap, the fix is small."
    assert humanize("A narrow gap — real, but narrow — so we shipped.") == (
        "A narrow gap, real, but narrow, so we shipped.")
    assert humanize("It cut findings by 60% in 2021–2023, about 40–50 services.") == (
        "It cut findings by 60% in 2021–2023, about 40–50 services.")  # number ranges aren't pauses
    assert humanize("It was fine —.") == "It was fine."


def test_canned_openers_go() -> None:
    assert humanize("Great question. I'd start with the payment flow.") == "I'd start with the payment flow."
    assert humanize("Absolutely! the short answer is yes.") == "The short answer is yes."
    assert humanize("Sure is a word I'd avoid.") == "Sure is a word I'd avoid."  # only the canned opener


def test_stiff_words_become_plain_ones() -> None:
    assert humanize("We utilize OAuth in order to scope tokens.") == "We use OAuth to scope tokens."
    assert humanize("Utilizing caching helped.") == "Using caching helped."
    assert humanize("I'd leverage the existing gateway.") == "I'd use the existing gateway."
    assert humanize("In a salary talk you want leverage.") == "In a salary talk you want leverage."  # the noun stays


def test_it_is_stable_while_streaming() -> None:
    """Applied to every snapshot: a word still arriving isn't changed until it's whole, and the result never flips."""
    p = AnswerStreamParser("q", QuestionType.technical, [])
    assert p.feed("ANSWER:\nWe utiliz").direct_answer == "We utiliz"
    assert p.feed("e OAuth — it").direct_answer == "We use OAuth, it"
    full = p.feed(" works.").direct_answer
    assert full == "We use OAuth, it works." and humanize(full) == full  # idempotent


def test_code_is_never_touched() -> None:
    p = AnswerStreamParser("q", QuestionType.coding, [])
    ans = p.feed("ANSWER:\nTwo pointers — linear time.\nCODE: python\n```python\nx = 1  # utilize — keep\n```\n")
    assert ans.direct_answer == "Two pointers, linear time."
    assert ans.code is not None and ans.code.content == "x = 1  # utilize — keep"


def test_the_prompt_asks_for_a_human_voice_and_has_no_em_dashes_itself() -> None:
    prompt = live_system_prompt()
    assert "HOW IT SOUNDS" in prompt and "corrective contrasts" in prompt and "wrap-up" in prompt
    assert "—" not in prompt  # the model copies the prompt's own punctuation
