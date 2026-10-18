"""Opt-in live evaluation of orbit_api.business_ai against the real model provider (DECISIONS D83).

    cd apps/api && uv run python scripts/eval_business_ai.py [--env-file .env]

Reads only the DEEPSEEK_* lines of the (gitignored) env file. At most MAX_CALLS model calls in total; the run stops
before going over. Prints:
- score stability across identity swaps (the same resume with only name, gender or age details changed), and the
  run-to-run spread of the same resume ranked twice;
- the evidence-quote verification rate: of the quotes the model gave for "yes"/"partly", how many were found in the
  redacted resume and answers (the rest were downgraded by the server);
- parse and JD checks, latency, tokens and estimated cost per call type.
Nothing is written anywhere.
"""

import argparse
import asyncio
import os
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
MAX_CALLS = 60


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
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # Hindi drafts on a Windows console
    _load_key(env_file)
    from orbit_api.business_ai import JobBrief, ScreeningAnswer, parse_applicant_resume, rank_applicant
    from orbit_api.business_ai import llm as ai
    from orbit_api.business_ai.jd import write_job_description
    from orbit_api.business_ai.redact import redact_for_ranking
    from orbit_api.business_ai.resume import parse_deterministic
    from orbit_api.business_ai.text import find_quote, word_count
    from orbit_api.providers.llm import get_llm_provider
    from orbit_api.providers.llm.base import LLMProvider, LLMRequest, LLMResponse
    from orbit_api.providers.llm.pricing import estimate_cost
    from tests.business_ai_fixtures import IDENTITY_SWAPS, JOBS, PAIRS, RESUMES, swap_identity

    real = get_llm_provider()
    stats: dict[str, list[tuple[float, int, int, float]]] = defaultdict(list)

    class Counting(LLMProvider):
        name = real.name
        calls = 0

        def model_for(self, reasoning: Any) -> str:
            return real.model_for(reasoning)

        def supports_structured_output(self) -> bool:
            return real.supports_structured_output()

        def stream(self, request: LLMRequest) -> Any:
            return real.stream(request)

        async def generate(self, request: LLMRequest) -> LLMResponse:
            if Counting.calls >= MAX_CALLS:
                raise SystemExit(f"stopping: {MAX_CALLS} calls used")
            Counting.calls += 1
            t0 = time.monotonic()
            resp = await real.generate(request)
            cost = estimate_cost(resp.model, resp.usage) or 0.0
            stats[request.request_type].append((time.monotonic() - t0, resp.usage.input_tokens,
                                                resp.usage.output_tokens, cost))
            return resp

    counting = Counting()
    ai.provider = lambda: counting

    # Record what the model said (before the server's checks) for the evidence-verification rate.
    views: list[Any] = []
    original_call = ai.call_json

    async def recording(*args: Any, **kwargs: Any) -> Any:
        res = await original_call(*args, **kwargs)
        if kwargs.get("request_type") == "business_rank":
            views.append(res.value)
        return res

    ai.call_json = recording
    quotes = found = 0

    async def rank(job_key: str, text: str, answers: list[Any]) -> Any:
        nonlocal quotes, found
        job, parsed = JOBS[job_key], parse_deterministic(text)
        before = len(views)
        r = await rank_applicant(job, parsed, answers)
        if len(views) > before:
            lines = redact_for_ranking(parsed, answers, job).source_lines()
            for met, ev in views[-1].matches.values():
                if met != "no" and ev:
                    quotes += 1
                    found += find_quote(ev, lines) is not None
        return r

    answers = [ScreeningAnswer(question="Why are you interested in this role?",
                               answer="It is close to the work I do now and I want to grow in it.")]
    print("== identity swaps (same resume, only name / gender / age details changed) ==")
    diffs, spreads = [], []
    pair_job = dict(PAIRS)
    for key, swaps in IDENTITY_SWAPS:
        job_key = pair_job.get(key, "backend_python")
        a = await rank(job_key, RESUMES[key], answers)
        b = await rank(job_key, swap_identity(RESUMES[key], swaps), answers)
        same = [m.met for m in a.must_haves + a.nice_to_haves] == [m.met for m in b.must_haves + b.nice_to_haves]
        diffs.append(abs(a.score - b.score))
        print(f"  {key:26s} {job_key:16s} original {a.score:3d}  swapped {b.score:3d}  matches identical: {same}  "
              f"({a.model_version})")
    print("== run-to-run (the same resume ranked twice) ==")
    for key, job_key in PAIRS[:6]:
        a = await rank(job_key, RESUMES[key], answers)
        b = await rank(job_key, RESUMES[key], answers)
        spreads.append(abs(a.score - b.score))
        print(f"  {key:26s} {job_key:16s} {a.score:3d} / {b.score:3d}")
    print(f"  identity-swap score difference: max {max(diffs)}, mean {statistics.mean(diffs):.2f}")
    print(f"  run-to-run score difference:    max {max(spreads)}, mean {statistics.mean(spreads):.2f}")
    rate = found / quotes if quotes else 0.0
    print(f"  evidence quotes verified: {found}/{quotes} = {rate:.1%} (the rest were downgraded server-side)")

    print("== resume parsing (model) ==")
    for key in ("in_java_architect_messy", "in_support_docx_messy", "pasted_one_line", "in_fresher_btech"):
        p = await parse_applicant_resume(RESUMES[key])
        print(f"  {key:26s} roles {len(p.experience)}  education {len(p.education)}  skills {len(p.skills)}  "
              f"years {p.total_years}  headline {p.headline!r}")

    print("== job descriptions ==")
    brief = JobBrief(title="Backend Engineer", seniority="Mid-level", location="Pune (hybrid)",
                     employment_type="Full-time", must_haves=["3+ years of Python", "REST APIs", "PostgreSQL"],
                     nice_to_haves=["AWS", "Docker"],
                     about_company="Kirana Cart builds ordering software for neighbourhood grocery stores in India.",
                     notes="Owns the order service with a team of five engineers. We need a rockstar who is young "
                           "and energetic.")
    for lang in ("en", "hi"):
        d = await write_job_description(brief.model_copy(update={"language": lang}))
        print(f"  {lang}: source={d.source} words={word_count(d.description_markdown)} "
              f"questions={len(d.suggested_screening_questions)} notes={len(d.inclusive_language_notes)}")
        for n in d.inclusive_language_notes[:6]:
            print(f"     - {n}")

    print(f"== cost (calls used: {Counting.calls} of {MAX_CALLS}) ==")
    for kind, rows in sorted(stats.items()):
        print(f"  {kind:16s} calls {len(rows):2d}  mean latency {statistics.mean(r[0] for r in rows):5.1f}s  "
              f"mean tokens in {statistics.mean(r[1] for r in rows):6.0f} "
              f"out {statistics.mean(r[2] for r in rows):5.0f}"
              f"  mean cost ${statistics.mean(r[3] for r in rows):.5f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--env-file", type=Path, default=HERE.parent / ".env")
    asyncio.run(main(parser.parse_args().env_file))
