"""STT custom vocabulary: individual terms the interview will use, not whole resume lines."""

from orbit_api.documents.parsing import chunk_document
from orbit_api.live.keyterms import MAX_KEYTERMS, extract_keyterms
from orbit_api.retrieval.index import IndexedChunk

RESUME = """Jane Doe
Senior Backend Engineer
SKILLS
Languages: Python, Go, TypeScript, SQL
Infrastructure: Kubernetes, Terraform, AWS (EKS, Lambda), PostgreSQL, Kafka, Redis
EXPERIENCE
Acme Corp — Senior Engineer (2021–Present)
- Built payment services on Node.js and C++ handling 10k TPS
"""
JD = """Northwind Payments - Staff Engineer
Requirements
- 6+ years with Go or Rust, gRPC and Protobuf
- Experience with ClickHouse, Snowflake or BigQuery
"""


def _chunks() -> list[IndexedChunk]:
    out = [IndexedChunk(f"r{i}", "resume", c.category, c.label, c.text, True, [])
           for i, c in enumerate(chunk_document(RESUME, "resume", "cv"))]
    return out + [IndexedChunk(f"j{i}", "job_description", c.category, c.label, c.text, False, [])
                  for i, c in enumerate(chunk_document(JD, "job_description", "jd"))]


def test_keyterms_are_single_terms_from_skills_documents_and_the_company() -> None:
    terms = extract_keyterms(_chunks(), company="Northwind", role="Staff Backend Engineer")
    assert terms[0] == "Northwind"
    # a long skills line used to be dropped whole; its terms are all here now
    for t in ("Kubernetes", "Terraform", "PostgreSQL", "Kafka", "EKS", "Lambda"):
        assert t in terms, t
    for t in ("gRPC", "Rust", "Protobuf", "ClickHouse", "Snowflake", "BigQuery", "Node.js", "C++"):
        assert t in terms, t
    assert not any(":" in t for t in terms)  # no "Languages: …" lines
    assert "Engineer" not in terms and "Corp" not in terms  # generic words the model already knows
    assert len({t.lower() for t in terms}) == len(terms)


def test_keyterms_are_capped() -> None:
    many = [IndexedChunk(str(i), "resume", "skill", "Skills", f"Tool{i}x, Lib{i}y", True, []) for i in range(60)]
    assert len(extract_keyterms(many)) == MAX_KEYTERMS
