"""Orbit Apply: the candidate's own auto-apply (docs/DECISIONS.md D84). The server plans and the candidate's device
submits.

- `setup.py`: the one-time setup. The master resume the candidate approves, the facts they confirm (contact, work
  authorisation per country, notice period, salary only if they give it, links, years), filters, mode (Automatic or
  Review first), the daily limit, quiet hours and consent.
- `bank.py`: the answer bank. About 30 common screening questions, each matched to form labels, and the hard rules
  for answering them (`rules.py`).
- `forms.py`: each ATS's public application form (Greenhouse's job board API with `questions=true`, Lever's apply
  page, Ashby's public posting GraphQL) read into one list of questions.
- `resolve.py`: where a listing can be applied to. Its own Greenhouse, Lever or Ashby form, Orbit Direct (`direct.py`,
  a seam until Orbit for Business lands), or a hand-off for a job board, which Orbit never automates.
- `tailor.py` and `letters.py`: the resume reordered and reworded for the job from true facts only, with a diff, and
  a short cover letter. `pdf.py` writes the resume the executor uploads.
- `planner.py`: picks jobs from Jobs AI's feed and turns each into an ApplicationPacket. It runs from the sweeper
  and on demand.
- `pacing.py`: what's due. The daily and per-company caps, spacing per ATS board and overall, quiet hours and the
  per-site kill switch. `quota.py`: the plan's applications and top-up credits, charged only on a confirmed
  submission.
- `routes.py`: `/v1/apply/...` for the web app, plus the executor contract (`GET /v1/apply/next`,
  `POST /v1/apply/{id}/result`, `GET /v1/apply/status`), which works with an extension-scoped token.
"""
