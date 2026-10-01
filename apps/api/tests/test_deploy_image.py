"""The deploy image must run the Python the test suite runs on; anything else ships an untested interpreter."""

import re
import tomllib
from pathlib import Path

API = Path(__file__).resolve().parents[1]
CI = API.parents[1] / ".github" / "workflows" / "ci.yml"


def test_docker_python_matches_ci_and_mypy() -> None:
    image = re.search(r"^FROM python:(\d+\.\d+)-", (API / "Dockerfile").read_text(), re.M)
    assert image, "Dockerfile should build FROM python:<major>.<minor>-…"
    mypy = tomllib.loads((API / "pyproject.toml").read_text())["tool"]["mypy"]["python_version"]
    assert image[1] == mypy
    if CI.is_file():
        assert set(re.findall(r'python-version: "(\d+\.\d+)"', CI.read_text())) == {image[1]}
