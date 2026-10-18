"""Orbit for Business (D82): a company workspace on the same site and API, kept apart from the candidate side.

- companies.py: the workspace, verification (work email or DNS), members and invites, plan, templates, audit.
- jobs.py: jobs (draft, publish, pause, close), the AI writer, Google for Jobs JSON-LD and the Indexing API.
- apply.py: applying (one click from an Orbit account, or a resume upload), the public careers and status pages.
- pipeline.py: applicants by stage, moves, rejection, notes and mentions, scorecards, scheduling, export, deletion.
- ranking.py: resume parsing and ranking with reasons in the background (through ai_port.py).
- retention.py: deletes rejected applicants' data when the company's retention runs out.
- admin.py: the Orbit team's review of companies, jobs and reports.

The separation rule: company routes only ever read biz_* rows of the caller's company. What an applicant shares is
copied into their application when they apply; nothing here reads a candidate's own Orbit data afterwards.
"""
