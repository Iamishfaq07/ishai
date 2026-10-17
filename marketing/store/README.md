# Microsoft Store screenshots

Five screenshots of the app with made-up demo data, light theme, each at 1366 x 768 and 2560 x 1440 (both sizes the
Store accepts for desktop apps). Plain full-window screenshots: no device frames, no captions baked in. The screens
are the ones the Windows app shares with the web app (`packages/ui`), captured from the web app on a local stack.
The PNGs aren't in git (`../.gitignore`): capture them, then copy them to the owner's assets folder
(`C:/Users/Ishfaq/Project/orbit-marketing-assets/store`).

| File | Screen | Alt text |
| --- | --- | --- |
| `01-copilot-*.png` | Live interview | Orbit during an interview: the interviewer's question, a suggested answer built from the candidate's resume, its key points and the resume line it used, beside the live transcript. |
| `02-practice-*.png` | Mock interview review | The review of a mock interview: a score of 4 out of 5, what went well, what to improve and what to practise next. |
| `03-resume-*.png` | Resume AI | The Resume AI editor with a resume, its live preview and an ATS score of 98. |
| `04-jobs-*.png` | Jobs AI matches | Jobs matched to the resume, each with a fit score and the skills it matched, from companies' own careers pages. |
| `05-mission-*.png` | Mission room | The Mission room for one application: the steps from discover to negotiate, and the prep plan for an interview in two days. |

Suggested Store captions (short, factual): "Answers from your own resume, live", "Practise out loud with an AI
interviewer", "See your resume's ATS score", "Jobs that fit your resume", "One place for every application". The
listing should also say: "For practice and interviews where AI help is allowed."

Re-capture with `node marketing/screens/capture.mjs --store` (see `../screens/README.md` for seeding the local stack;
`--themes light,dark` adds dark copies named `…-dark.png`).
