"""Every admin endpoint refuses everyone but the admin (403), found from the app's own route table so a route added
later is covered without anyone remembering to list it. `/v1/admin/status` is the one exception: it tells any
signed-in user whether they are the admin."""

import re
from typing import Any

from fastapi.testclient import TestClient

from tests.test_admin_console import _user, console  # noqa: F401  (fixture)

OPEN = {"/v1/admin/status"}


def _admin_routes(client: TestClient) -> list[tuple[str, str]]:
    """(method, path) for every admin operation in the OpenAPI schema (which lists every included router)."""
    paths: dict[str, dict[str, Any]] = client.app.openapi()["paths"]  # type: ignore[attr-defined]
    return [(method.upper(), re.sub(r"\{[^}]+\}", "x", path))
            for path, ops in sorted(paths.items()) if path.startswith("/v1/admin") and path not in OPEN
            for method in sorted(ops) if method in {"get", "post", "put", "patch", "delete"}]


def test_every_admin_route_is_forbidden_to_a_non_admin(console: Any) -> None:  # noqa: F811
    client, admin, _ = console
    routes = _admin_routes(client)
    assert len(routes) > 20  # the route table was read (costs, users, payments, inbox, support, config ...)
    h, _ = _user(client, "guard")
    for method, path in routes:
        r = client.request(method, path, headers=h, json={})
        assert r.status_code == 403, (method, path, r.status_code, r.text[:200])
    # Signed out is refused too (401, or 403 from the CSRF check), and the admin gets past the guard.
    client.cookies.clear()
    for method, path in routes:
        assert client.request(method, path, json={}).status_code in (401, 403), (method, path)
    assert client.get("/v1/admin/costs", headers=admin).status_code == 200
