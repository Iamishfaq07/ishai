"""Jobs: the latest job posts that match the user's resume, from sources that allow it (docs/DECISIONS.md D43).

- `sources/`: one small module per source, all behind one interface (`sources/base.py`): companies' own job boards
  (Greenhouse, Lever, Ashby, SmartRecruiters), remote-jobs feeds (Himalayas, RemoteOK, Jobicy), and two optional
  search APIs that only switch on with a key (Adzuna, JSearch). Nothing is scraped.
- `postings.py`: what every source's post is normalized to (places, workplace, experience, snippet, dedupe key).
- `refresh.py`: the cache. Listings live in the database; a feed request refreshes stale sources in the background
  (one refresh per source at a time) while it serves what's cached, and a gentle in-process loop keeps them fresh.
- `ranking.py`: the deterministic match score, filters, dedupe and sorting, all on cached rows.
- `profile.py` and `fit.py`: the AI around it (a search profile read from a resume, a fit check per job), free and
  capped per day. `portals.py`: "search on LinkedIn / Naukri / …" links prefilled from the profile.
- `routes.py`: `/v1/jobs/...`.
"""
