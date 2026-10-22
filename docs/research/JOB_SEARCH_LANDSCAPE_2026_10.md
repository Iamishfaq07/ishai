# Job-search landscape research — 21 October 2026

Seven rounds of research across GitHub, Claude skills, Hugging Face, commercial tools and Indian portals, and what Orbit built from them (PRs #478–#483).

**Caveats**
- Star counts, prices and feature claims come from READMEs, vendor blogs and comparison pages, which often disagree. They are descriptions, not verified facts.
- No third-party code, prompts, models or datasets were copied or installed. Every feature below is Orbit's own implementation of a publicly described pattern.
- Licences are listed in [EXTERNAL_IDEAS_AND_LICENSES.md](EXTERNAL_IDEAS_AND_LICENSES.md) where they were checked.

## What the landscape looks like

### Open-source job agents (GitHub)

**[career-ops](https://github.com/career-ops-hq/career-ops)** is the largest. Its features:
- an A–H evaluation and a 1–5 score per job;
- portal scanning across Greenhouse, Ashby, Lever and Wellfound;
- batch evaluation and a fact-checked CV PDF;
- cover letters, contact finder, story bank and follow-up cadence;
- reply classification and rejection-pattern analytics;
- offer-prep (contract clauses), adjacent titles and interview red flags.

It never submits applications.

**[MadsLorentzen/ai-job-search](https://github.com/topics/ai-job-search)** was trending in October. Its features:
- a posting integrity gate (hidden text, invisible characters, lines that look like instructions);
- deal-breaker and language vetoes;
- follow-ups (two at most), Gmail status sync, an upskill heatmap and an HTML report.

**Smaller agents follow the same review-first pattern:**
- [AIHawk](https://github.com/feder-cr/LinkedIn_AIHawk_automatic_job_application): blacklists, one application per company;
- [ai-job-agent](https://github.com/AkbarDevop/ai-job-agent): dry-run by default;
- [JobApplyAgent](https://github.com/shankswhite/JobApplyAgent): an answer cache;
- [AutoApply](https://github.com/phcastello/AutoApply): review mode.

**Early-career lists and monitors:**
- [zapplyjobs](https://github.com/topics/job-search) and keryx publish new-grad and internship lists;
- monitors poll ATS boards every 15–30 minutes with visa and level filters;
- honest-cv tailors without claiming skills the user lacks.

### Resume tools
- **[Resume-Matcher](https://github.com/srbhr/resume-matcher):**
  - a JD-match score built in plain code: keywords 40%, skills 20%, title 15%, sections 15%, dates 10%;
  - an ATS text-extraction check and a tailoring queue;
  - cover letters (200–300 words, grounded in the user's own facts) and ten templates.
- **Repo-to-bullets tools:** GitResume, GitApply and Resummit turn repositories into bullets; OpenDraft applies Google's X-Y-Z formula.

### Interview tools
- [InterviewOS](https://github.com/interview-ps/InterviewOS) keeps per-skill readiness backed by evidence. It gives older evidence less weight and retests weak skills first.
- GPTInterviewer and InterviewSim offer rubric scoring.
- Commercial copilots:
  - [Final Round, LockedIn, Verve and Parakeet](https://www.hedy.ai/post/best-ai-interview-assistant-tools/) give live answers. Verve also adds tone and confidence analysis.
  - Cluely's reported 2025 breach shows the privacy risk of cloud copilots.

### Claude skills
- [JobMentis's open skills](https://www.jobmentis.com/en/claude-skills-for-job-hunting) never invent facts and turn git history into stories.
- [Faizee-Asad job-seeker skills](https://blog.asadfaizee.is-a.dev/posts/claude-skills-for-job-seekers/) produce a one-command application pack.
- Proficiently and open-career-skills offer smaller collections.

### Hugging Face
- There are skill and resume NER models: [gmay29/ner_model_final](https://huggingface.co/gmay29/ner_model_final/blob/main/README.md) (synthetic training data) and [oksomu/resume-ner](https://app.alphaneural.io/assets/oksomu/resume-ner) (about 98% F1 on clean resumes, about 69% on noisy text).
- A [PyData talk](https://london2023.pydata.org/cfp/talk/7SKYJ3) maps extracted skills to ESCO and Lightcast.
- **Decision:** keep Orbit's curated skill vocabulary and synonyms. A model adds weight and is unreliable on real PDFs.

### Commercial trackers and platforms
- **[Teal, Huntr, Simplify, Jobright](https://www.dreamworkhq.com/compare/simplify-alternatives):** a tracker plus autofill. Simplify+ and Jobright apply for you; reports differ on whether a review step exists.
- **[LinkedIn](https://getcoai.com/news/linkedins-new-ai-tool-aims-to-match-you-with-the-perfect-job):** Job Match, natural-language search, and hiring signals such as response times.
- **[Naukri, Apna, Internshala, Unstop](https://bestjobsearchapps.com/articles/en/best-job-sites-in-india-2026-naukri-vs-linkedin-vs-indeed-and-complete-guide):** AI matching and resume scoring. Unstop is built around assessments.

## What Orbit built from it

| PR | Feature | Pattern it adapts |
|---|---|---|
| #478 | **Apply priority** (`/jobs/priority`): 1.0–5.0 score, A–F grade; match comes from the saved job post, level and freshness from records, the rest rated by the candidate | career-ops A–F evaluation |
| #478 | **STAR answer check** (`/star-check`): STAR+R rubric with quoted evidence, numbers, I/we, length, filler words | InterviewSim, STAR+R |
| #479 | **Bullet builder** (`/bullet-builder`) | Google X-Y-Z, OpenDraft |
| #479 | **Career gap explainer** (`/career-gap`) | Coach guidance |
| #479 | **Group discussion practice** (`/group-discussion`) | Placement-prep resources |
| #479 | **What to say about pay** (Offers): recruiter-screen salary scripts | job-search-os interview coach |
| #479 | **Resign well** (Offers): last working day, letter, exit checklist (India: relieving letter, PF/UAN, Form 16) | Offer and exit guides |
| #480 | **Skill readiness** (`/readiness`): evidence-backed, decays over 30 days, plan ordered by demand × gap | InterviewOS |
| #480 | **Deal-breakers** on Apply priority | ai-job-search, career-ops vetoes |
| #480 | **Posting integrity** in the scam check: lines aimed at AI, invisible characters | ai-job-search integrity gate |
| #481 | **Campus placements** (`/campus`): eligibility against cut-offs, countdown, prep for each round | New-grad and internship trackers (India on-campus gap) |
| #481 | **Activity map** on the Tracker: 26-week contribution-style map and streak | Contribution-style trackers |
| #482 | **Offer letter check** (Offers): bond, non-compete, clawback, notice and more, with questions for HR | career-ops offer-prep |
| #482 | **Adjacent titles** in Search preferences | career-ops `titles` |
| #482 | **Interview red flags** for each job | career-ops interview-redflag |
| #483 | **GitHub projects** (`/github-projects`): public repos → projects, skills, story prompts | GitResume, Resummit, JobMentis git-history |

Every feature above works without inventing a fact.
- Numbers, results and ratings come from the candidate.
- Nothing is sent to an employer.
- Text typed into these tools stays on the device unless an existing Orbit API stores it.

## Already in Orbit before this research
- **Search:**
  - plain-language search parsing (`job_portal/search_parse.py`);
  - fresher and internship chips, visa and relocation filters;
  - job alerts and a weekly digest.
- **Applications:**
  - company blocklist and per-company caps;
  - review-first auto-apply with receipts;
  - the answer bank.
- **Resume:**
  - tailoring queue;
  - ATS match and keyword highlighting;
  - shortlist skill gaps;
  - resume performance.
- **Interviews:**
  - mock interviews with voice, panel and video;
  - delivery coach;
  - Code AI.
- **Offers:** offer comparison, in-hand pay, negotiation practice.
- **People:** contact finder.
- **Safety:** scam check, desktop privacy shield.

## Still worth doing (not built)
- **More company boards (Workable, Recruitee):** each company slug must be checked live before it's added.
  - *OWNER ACTION REQUIRED:* run the check from a network that can reach those APIs, or extend `ORBIT_JOBS_BOARDS_JSON` with verified boards.
- **Hiring signals:** how fast a company replies, from Orbit's own tracker data aggregated across users.
  - Needs a privacy review and minimum group sizes before showing any number.
- **Repost detection across the feed:** the same title from the same company re-posted within N days. This needs API work in `job_portal/signals.py`.
- **Score calibration:** compare Apply-priority grades with the outcomes the candidate records. This needs grades stored server-side.
- **Tests for every feature above:** deferred until the owner asks for the test pass.
