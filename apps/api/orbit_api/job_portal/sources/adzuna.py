"""Adzuna (optional): `GET api.adzuna.com/v1/api/jobs/{country}/search/1?what=…&where=…&sort_by=date`, on only when
ORBIT_ADZUNA_APP_ID and ORBIT_ADZUNA_APP_KEY are set. It covers India and about 20 other countries (COUNTRIES);
a search for anywhere else isn't sent.

Free tier: 25 calls a minute, 250 a day, 2,500 a month; the shared quota (`budget`) stops at 90% of each, and
queries are shared between everyone searching the same title and place. Terms: every post is labelled "Adzuna" at
least 116 x 23 px, linked to adzuna.in; the link to the job is Adzuna's `redirect_url`; only its snippet is shown.
https://developer.adzuna.com/docs/terms_of_service
"""

from datetime import timedelta
from typing import Any

from orbit_api.config import get_settings
from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.postings import Posting, clean_line, employment_type_of, obj, parse_time, salary_text
from orbit_api.job_portal.sources.base import Attribution, Budget, SearchQuery, Source
from orbit_api.region import country_name

API = "https://api.adzuna.com/v1/api/jobs/{country}/search/1"
# The countries Adzuna has, and the currency its salaries are in.
COUNTRIES: dict[str, str] = {
    "IN": "INR", "GB": "GBP", "US": "USD", "CA": "CAD", "AU": "AUD", "NZ": "NZD", "SG": "SGD", "ZA": "ZAR",
    "DE": "EUR", "FR": "EUR", "NL": "EUR", "AT": "EUR", "BE": "EUR", "ES": "EUR", "IT": "EUR", "PL": "PLN",
    "CH": "CHF", "BR": "BRL", "MX": "MXN",
}


def parse_job(j: Any, query_key: str, country: str = "IN") -> Posting | None:
    if not isinstance(j, dict) or not j.get("id") or not j.get("title") or not j.get("redirect_url"):
        return None
    company = obj(j.get("company"))
    loc = obj(j.get("location"))
    area = [str(a) for a in (loc.get("area") or []) if a]
    place = str(loc.get("display_name") or ", ".join(reversed(area)))
    kind = " ".join(str(j.get(k) or "") for k in ("contract_time", "contract_type"))
    name = "India" if country == "IN" else (country_name(country) or country).removeprefix("the ")
    return Posting(
        source="adzuna", external_id=str(j["id"]), board=query_key,
        company=str(company.get("display_name") or ""), title=clean_line(j["title"], 300),
        url=str(j["redirect_url"]), apply_url=str(j["redirect_url"]), posted_at=parse_time(j.get("created")),
        locations=[f"{place}, {name}" if place and name.lower() not in place.lower() else place or name],
        description=clean_line(j.get("description"), 1_000), employment_type=employment_type_of(kind),
        salary=salary_text(j.get("salary_min"), j.get("salary_max"), COUNTRIES.get(country, "INR"), "year"),
        country=country)


class Adzuna(Source):
    id = "adzuna"
    label = "Adzuna"
    kind = "search"
    hosts = frozenset({"api.adzuna.com"})
    ttl = timedelta(hours=12)
    attribution = Attribution("Adzuna", "https://www.adzuna.in", large=True)
    snippet_only = True

    def quota(self) -> Budget | None:
        return Budget(per_minute=25, per_day=250, per_month=2_500)

    def configured(self) -> bool:
        s = get_settings()
        return bool(s.adzuna_app_id and s.adzuna_app_key)

    async def search(self, http: FeedClient, query: SearchQuery) -> list[Posting]:
        s = get_settings()
        if not (s.adzuna_app_id and s.adzuna_app_key):
            raise SourceError("Adzuna isn't configured")
        if query.country not in COUNTRIES:
            return []  # Adzuna doesn't cover it
        params: dict[str, Any] = {"app_id": s.adzuna_app_id, "app_key": s.adzuna_app_key.get_secret_value(),
                                  "what": query.what, "max_days_old": max(query.days, 1), "sort_by": "date",
                                  "results_per_page": 50, "content-type": "application/json"}
        if not query.anywhere():
            params["where"] = query.where
        data = await http.get_json(API.format(country=query.country.lower()), params=params)
        results = data.get("results") if isinstance(data, dict) else None
        if not isinstance(results, list):
            raise SourceError("Adzuna sent an unexpected shape")
        return [p for j in results if (p := parse_job(j, query.key(), query.country)) is not None]
