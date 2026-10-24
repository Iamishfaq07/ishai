"""Versioned synthetic message gate. Run from apps/api: python -m evals.career_quality."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from orbit_api.job_portal.message_updates import classify


def evaluate(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    cases = [json.loads(line) for line in data.decode().splitlines() if line.strip()]
    failures = []
    by_language: dict[str, Counter[str]] = {}
    for case in cases:
        result = classify(case["message"])
        exact = result.event == case["event"]
        grounded = result.source_quote in case["message"]
        counts = by_language.setdefault(case["language"], Counter())
        counts["cases"] += 1
        counts["correct"] += int(exact and grounded)
        if not exact or not grounded:
            failures.append({"id": case["id"], "expected": case["event"], "actual": result.event,
                             "grounded": grounded})
    return {"suite": "employer-message-patterns/v1", "dataset_sha256": hashlib.sha256(data).hexdigest(),
            "provider": "rules", "synthetic": True, "cases": len(cases), "passed": len(cases) - len(failures),
            "by_language": by_language, "failures": failures,
            "limits": "Synthetic regression coverage, not production accuracy or a held-out model benchmark. "
                      "Hindi/Hinglish cases test abstention; they do not establish language support."}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=Path(__file__).with_name("employer_messages.jsonl"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = evaluate(args.dataset)
    report = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(report + "\n")
    print(report)
    raise SystemExit(1 if result["failures"] else 0)


if __name__ == "__main__":
    main()
