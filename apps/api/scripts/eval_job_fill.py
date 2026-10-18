"""Opt-in live evaluation of the job assistant (business_ai.fill_job, DECISIONS D85) against the real model provider.

    cd apps/api && uv run python scripts/eval_job_fill.py --env-file <path to a .env with DEEPSEEK_API_KEY>

Reads only the DEEPSEEK_* lines of the env file. At most MAX_CALLS model calls in total (a repair counts); the run
stops before going over. For each prompt it checks what the server guarantees whatever the model says (pay only as
written, no pay when none was given, the expected place / workplace / type / level, no question or requirement on a
personal characteristic, knock-outs only from stated numbers) and prints the source, latency, tokens and estimated
cost per call. Nothing is written anywhere.
"""

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
MAX_CALLS = 20

# prompt, expected: (workplace, employment_type, experience, (min, max, currency, period) | None, a location or "")
FILLS: list[tuple[str, tuple[Any, ...]]] = [
    ("Senior React developer, Bengaluru hybrid, 18–28 LPA, 5+ years",
     ("hybrid", "full_time", "senior", (1_800_000, 2_800_000, "INR", "year"), "Bengaluru, IN")),
    ("Sales executive Mumbai, fresher OK", ("onsite", "full_time", "entry", None, "Mumbai, IN")),
    ("Remote backend engineer, Go, Europe time zones, $90–120k",
     ("remote", "full_time", None, (90_000, 120_000, "USD", "year"), "")),
    ("Part-time content writer, remote India, ₹25,000 per month",
     ("remote", "part_time", None, (25_000, 25_000, "INR", "month"), "")),
    ("Marketing intern in Pune, stipend 15k/month, 3 months",
     (None, "internship", "entry", (15_000, 15_000, "INR", "month"), "Pune, IN")),
    ("Data analyst Hyderabad 6-10 LPA 2-4 yrs SQL Excel, Power BI a plus",
     (None, "full_time", "junior", (600_000, 1_000_000, "INR", "year"), "Hyderabad, IN")),
    ("बेंगलुरु में सेल्स एग्जीक्यूटिव चाहिए, 2 साल अनुभव, 25,000 प्रति माह",
     (None, None, "junior", (25_000, 25_000, "INR", "month"), "Bengaluru, IN")),
    ("Engineering manager, Berlin, €95–120k, 10+ yrs, hiring process: take-home assignment then 2 interviews",
     (None, "full_time", "lead", (95_000, 120_000, "EUR", "year"), "Berlin, DE")),
    ("Customer support executive Noida, male only, below 30, Hindi and English speaking",
     ("onsite", None, None, None, "Noida, IN")),
    ("Python developer Gurgaon, immediate joiners, AWS",
     (None, "full_time", None, None, "Gurugram, IN")),
]
# instruction, the fields it may change (a superset), a check on the result
REFINES: list[tuple[str, set[str]]] = [
    ("add a notice period question", {"questions"}),
    ("make it more junior", {"experience", "must_haves", "questions", "description", "title"}),
    ("add Hindi requirement", {"must_haves", "questions", "description"}),
    ("shorter description", {"description"}),
]


def _load_key(env_file: Path) -> None:
    if not env_file.is_file():
        sys.exit(f"no env file at {env_file}: pass --env-file with a DEEPSEEK_API_KEY")
    for line in env_file.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key.startswith("DEEPSEEK_"):
            os.environ[key] = value.strip().strip('"').strip("'")
    if not os.environ.get("DEEPSEEK_API_KEY"):
        sys.exit("DEEPSEEK_API_KEY not found in the env file")
    os.environ["ORBIT_LLM_PROVIDER"] = "deepseek"


async def main(env_file: Path) -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    _load_key(env_file)
    from orbit_api.business_ai import llm as ai
    from orbit_api.business_ai.fairness import asks_protected
    from orbit_api.business_ai.job_fill import CompanyContext, JobFill, JobFillRequest, fill_job, screens_on_person
    from orbit_api.business_ai.text import word_count
    from orbit_api.providers.llm import get_llm_provider
    from orbit_api.providers.llm.base import LLMProvider, LLMRequest, LLMResponse
    from orbit_api.providers.llm.pricing import estimate_cost

    real = get_llm_provider()
    calls: list[tuple[str, float, int, int, float]] = []

    class Counting(LLMProvider):
        name = real.name

        def model_for(self, reasoning: Any) -> str:
            return real.model_for(reasoning)

        def supports_structured_output(self) -> bool:
            return real.supports_structured_output()

        def stream(self, request: LLMRequest) -> Any:
            return real.stream(request)

        async def generate(self, request: LLMRequest) -> LLMResponse:
            if len(calls) >= MAX_CALLS:
                raise SystemExit(f"stopping: {MAX_CALLS} calls used")
            t0 = time.monotonic()
            resp = await real.generate(request)
            cost = estimate_cost(resp.model, resp.usage) or 0.0
            calls.append((request.request_type, time.monotonic() - t0, resp.usage.input_tokens,
                          resp.usage.output_tokens, cost))
            return resp

    counting = Counting()
    ai.provider = lambda: counting  # type: ignore[assignment]
    co = CompanyContext(name="Kirana Cart", country="IN",
                        about="Kirana Cart builds ordering software for neighbourhood grocery stores across India.")
    problems: list[str] = []
    first: JobFill | None = None
    for prompt, (workplace, employment, experience, pay, place) in FILLS:
        n0 = len(calls)
        out = await fill_job(JobFillRequest(description=prompt, company=co))
        first = first or out
        got_pay = (out.salary_min, out.salary_max, out.salary_currency, out.salary_period) \
            if out.salary_min is not None or out.salary_max is not None else None
        issues = []
        if got_pay != pay:
            issues.append(f"pay {got_pay} != {pay}")
        for name, want, have in (("workplace", workplace, out.workplace), ("type", employment, out.employment_type),
                                 ("level", experience, out.experience)):
            if want is not None and want != have:
                issues.append(f"{name} {have} != {want}")
        if place and place not in out.locations:
            issues.append(f"locations {out.locations} lack {place}")
        bad_q = [q.text for q in out.questions if asks_protected(q.text) or screens_on_person(q.text)]
        bad_m = [m for m in out.must_haves if screens_on_person(m)]
        if bad_q or bad_m:
            issues.append(f"protected: {bad_q + bad_m}")
        if any(q.knockout and q.knockout.max is not None for q in out.questions):
            issues.append("a maximum knock-out")
        words = word_count(out.description_markdown)
        print(f"\n[{out.source}] {prompt}\n  {out.title!r} · {out.department} · {out.locations} · {out.workplace} · "
              f"{out.employment_type} · {out.experience} · pay {got_pay} · {words} words · "
              f"{len(out.questions)} questions ({sum(1 for q in out.questions if q.knockout)} knock-outs) · "
              f"stages {'yes' if out.stages else 'no'} · calls {len(calls) - n0}")
        print(f"  must: {out.must_haves}\n  questions: {[q.text for q in out.questions]}")
        print(f"  assumed: {out.assumptions}\n  notes: {out.inclusive_language_notes}")
        if issues:
            problems.append(f"{prompt}: {'; '.join(issues)}")
            print(f"  ISSUES: {issues}")
    assert first is not None
    for instruction, allowed in REFINES:
        if len(calls) >= MAX_CALLS:
            break
        out = await fill_job(JobFillRequest(instruction=instruction, current=first, company=co))
        extra = set(out.changed_fields) - allowed
        print(f"\n[{out.source}] refine {instruction!r}: changed {out.changed_fields}; assumed {out.assumptions}")
        if extra or not out.changed_fields:
            problems.append(f"refine {instruction!r}: changed {out.changed_fields}")
    print(f"\n{len(calls)} model calls")
    by_type: dict[str, list[tuple[float, int, int, float]]] = {}
    for t, s, i, o, c in calls:
        by_type.setdefault(t, []).append((s, i, o, c))
    for t, rows in by_type.items():
        n = len(rows)
        print(f"  {t}: {n} calls, mean {sum(r[0] for r in rows) / n:.1f} s, in {sum(r[1] for r in rows) // n} / out "
              f"{sum(r[2] for r in rows) // n} tokens, ${sum(r[3] for r in rows) / n:.5f} per call, "
              f"${sum(r[3] for r in rows):.4f} total")
    print("\nproblems:" if problems else "\nno problems", *problems, sep="\n  ")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--env-file", type=Path, default=HERE.parent / ".env")
    asyncio.run(main(p.parse_args().env_file))
