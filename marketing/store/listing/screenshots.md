# Screenshots and Store logos

**Where the files are:** `C:\Users\Ishfaq\Project\orbit-marketing-assets\store\`. They're not in git (made by
`node marketing/screens/capture.mjs --store`; see `../README.md`). Each comes at 1366 × 768 and 2560 × 1440.

**Microsoft's rules:**
- Desktop screenshots are PNG, 1366 × 768 or larger (up to 3840 × 2160), no bigger than 50 MB.
- Up to 10 of them; at least 1 is required and 4 or more are recommended.
- Each has an optional caption of up to 200 characters.

Source: <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/screenshots-and-images>.

**Upload the 2560 × 1440 copies**, in this order. Paste the caption into the screenshot's caption field. The alt text
is for the website and README; the Store only has captions.

| # | File | Caption (Store) | Alt text |
| --- | --- | --- | --- |
| 1 | `01-copilot-2560x1440.png` | Live help where AI help is allowed: the question, short answer notes from your resume, and the transcript | Orbit during an interview: the interviewer's question, a suggested answer built from the candidate's resume, its key points and the resume line it used, beside the live transcript. |
| 2 | `02-practice-2560x1440.png` | Practise out loud with an AI interviewer, then see what went well and what to work on | The review of a mock interview: a score of 4 out of 5, what went well, what to improve and what to practise next. |
| 3 | `03-resume-2560x1440.png` | Resume AI, in your browser with the same account: a score out of 100 and fixes for the job you want | The Resume AI editor with a resume, its live preview and an ATS score of 98. |
| 4 | `04-jobs-2560x1440.png` | Jobs AI, in your browser: new jobs that fit your resume, from companies' own careers pages | Jobs matched to the resume, each with a fit score and the skills it matched, from companies' own careers pages. |
| 5 | `05-mission-2560x1440.png` | One place for every application, with a prep plan before each interview (Jobs AI, in your browser) | The Mission room for one application: the steps from discover to negotiate, and the prep plan for an interview in two days. |

**Be accurate about where each screen is** (policy 10.1.1: "All aspects of your product, including metadata, should
accurately describe the functions, features, user experience"):
- These five were captured from the web app.
- Screenshots 1 and 2 show screens the Windows app shares with the web app (`packages/ui`). In the Windows app, the
  live view is a compact window that stays on top. You can expand it.
- Screenshots 3 to 5 are website tools that the app opens in the browser. The captions say so, and so does the
  description.

**Add before or soon after the first submission** (a sixth, then seventh screenshot):
- 6: the Windows app's own window during a session, compact, over a fictional meeting. Caption: "A small window that
  stays on top of your call, with shortcuts you can change".
- 7: the Windows app's Setup screen: choose the microphone and the one app to listen to.

Capture both after the desktop redesign (D77) lands, with the isolated test build and the mock API. The recipe is in
the desktop test build notes; it never touches the installed Orbit. Use the same fictional person (Aditi Rao) and
1366 × 768 or larger. A real desktop screenshot is the strongest proof for the reviewer that the listing shows the
app.

**Store logos** (Store listings → Store logos):
- **1:1 app tile icon, 300 × 300:** upload [app-tile-icon-300x300.png](app-tile-icon-300x300.png). Microsoft
  "strongly recommends" it; without it the Store uses the package's logo. It's rendered from the brand mark by
  `marketing/brand/render-msix-assets.mjs`.
- 2:3 poster art and 1:1 box art don't apply to apps.
- **16:9 Super hero art** (1920 × 1080, no text) is optional. It's only used if Microsoft features the app; skip it
  for now.
