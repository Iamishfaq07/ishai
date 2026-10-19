"""Optional IPinfo Plus snapshot. A privacy-network flag is not an identity or dishonesty verdict."""
import ipaddress
from typing import Any

import httpx
from fastapi import Request

from orbit_api import ratelimit
from orbit_api.config import get_settings

# Recorded HTTP fixtures only in tests. Production defaults to the real HTTPS client.
TRANSPORT: httpx.AsyncBaseTransport | None = None


async def lookup(request: Request) -> dict[str, Any]:
    token = get_settings().business_ipinfo_token
    if token is None or not token.get_secret_value().strip():
        return {"status": "not_configured", "provider": "ipinfo"}
    if not ratelimit.proxy_signed(request):
        return {"status": "unavailable", "provider": "ipinfo"}
    try:
        ip = ipaddress.ip_address(ratelimit.client_ip(request))
    except ValueError:
        return {"status": "unavailable", "provider": "ipinfo"}
    if not ip.is_global:
        return {"status": "unavailable", "provider": "ipinfo"}
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=False, transport=TRANSPORT) as client:
            response = await client.get(f"https://api.ipinfo.io/lookup/{ip}",
                headers={"Authorization": f"Bearer {token.get_secret_value()}"})
            response.raise_for_status()
            if len(response.content) > 100_000:
                raise ValueError("Network response too large")
            data = response.json()
        anonymous = data.get("anonymous") if isinstance(data, dict) else None
        fields = ("is_vpn", "is_proxy", "is_tor", "is_relay")
        if not isinstance(anonymous, dict) or any(type(anonymous.get(k)) is not bool for k in fields):
            return {"status": "unavailable", "provider": "ipinfo"}  # wrong plan/partial data is not a clean check
        return {"status": "measured", "provider": "ipinfo", **{k: anonymous[k] for k in fields}}
    except (httpx.HTTPError, ValueError):
        return {"status": "unavailable", "provider": "ipinfo"}
