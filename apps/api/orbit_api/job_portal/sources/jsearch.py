"""JSearch on RapidAPI (optional, paid): Google for Jobs data, including posts whose apply links are on LinkedIn,
Indeed or Naukri. On only when ORBIT_JSEARCH_KEY is set; stops at 90% of ORBIT_JSEARCH_MONTHLY_BUDGET calls.

`GET jsearch.p.rapidapi.com/search?query=<title> jobs in <place>&country=<cc>&date_posted=…`, for the country the
searcher applies in. The apply link is the
employer's own when JSearch has one (`apply_options` with `is_direct`), else the publisher's.
https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
"""

import asyncio
from datetime import timedelta
from typing import Any

from orbit_api.config import get_settings
from orbit_api.job_portal.http import FeedClient, SourceError
from orbit_api.job_portal.postings import Posting, employment_type_of, parse_time, salary_text, text_of
from orbit_api.job_portal.sources.base import Attribution, Budget, SearchQuery, Source
from orbit_api.region import country_name

HOST = "jsearch.p.rapidapi.com"
_POSTED = {1: "today", 3: "3days", 7: "week", 30: "month"}


def parse_job(j: Any, query_key: str) -> Posting | None:
    if not isinstance(j, dict) or not j.get("job_id") or not j.get("job_title"):
        return None
    options = [o for o in (j.get("apply_options") or []) if isinstance(o, dict) and str(o.get("apply_link") or "")
               .startswith("https://")]
    direct = next((o for o in options if o.get("is_direct")), None)
    apply_url = str((direct or {}).get("apply_link") or j.get("job_apply_link") or "")
    if not apply_url.startswith("https://"):
        apply_url = str(options[0]["apply_link"]) if options else ""
    place = ", ".join(str(j.get(k)) for k in ("job_city", "job_state") if j.get(k))
    country = str(j.get("job_country") or "").upper()
    months = (j.get("job_required_experience") or {}).get("required_experience_in_months") \
        if isinstance(j.get("job_required_experience"), dict) else None
    text = text_of(j.get("job_description"))
    if isinstance(months, int | float) and months > 0 and "year" not in text[:3_000].lower():
        text = f"Experience: {round(months / 12)} years\n\n{text}"
    return Posting(
        source="jsearch", external_id=str(j["job_id"]), board=query_key,
        company=str(j.get("employer_name") or ""), title=str(j["job_title"]), url=apply_url, apply_url=apply_url,
        posted_at=parse_time(j.get("job_posted_at_datetime_utc") or j.get("job_posted_at_timestamp")),
        locations=[", ".join(x for x in (place, "India" if country == "IN" else country) if x)],
        description=text, workplace="remote" if j.get("job_is_remote") else None,
        employment_type=employment_type_of(str(j.get("job_employment_type") or "").replace("FULLTIME", "full time")
                                           .replace("PARTTIME", "part time")),
        salary=salary_text(j.get("job_min_salary"), j.get("job_max_salary"), j.get("job_salary_currency"),
                           j.get("job_salary_period")),
        country=country or None, open_to=[country] if country else [])


class JSearch(Source):
    id = "jsearch"
    label = "JSearch"
    kind = "search"
    hosts = frozenset({HOST})
    ttl = timedelta(hours=24)
    attribution = Attribution("Google for Jobs (JSearch)", "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch")

    def quota(self) -> Budget | None:
        return Budget(per_month=get_settings().jsearch_monthly_budget)

    def configured(self) -> bool:
        return bool(get_settings().jsearch_key)

    async def search(self, http: FeedClient, query: SearchQuery) -> list[Posting]:
        key = get_settings().jsearch_key
        if not key:
            raise SourceError("JSearch isn't configured")
        name = (country_name(query.country) or query.country).removeprefix("the ")
        where = name if query.anywhere() else f"{query.where}, {name}"
        data = await http.get_json(f"https://{HOST}/search", params={
            "query": f"{query.what} jobs in {where}", "country": query.country.lower(), "page": 1, "num_pages": 1,
            "date_posted": next((v for d, v in sorted(_POSTED.items()) if query.days <= d), "month")},
            headers={"X-RapidAPI-Key": key.get_secret_value(), "X-RapidAPI-Host": HOST})
        jobs = data.get("data") if isinstance(data, dict) else None
        if not isinstance(jobs, list):
            raise SourceError("JSearch sent an unexpected shape")
        return await asyncio.to_thread(lambda: [p for j in jobs if (p := parse_job(j, query.key())) is not None])
