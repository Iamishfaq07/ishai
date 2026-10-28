# Tool reliability improvements

This batch covers Bullet builder, STAR answer check, Career gap explainer, Aptitude practice,
Group discussion practice, GitHub projects, and the shared copy-output component.
It does not establish coverage of every product workflow.

## Candidate workflows

- Bullet, STAR and career-gap drafts use the existing account workspace API. Editing keeps a local
  recovery draft; **Save changes** syncs it to the account. A revision conflict preserves the local
  work and offers a download before loading the newer account version. No schema migration is needed.
- Existing unowned writing-tool browser data is offered for explicit review/import rather than
  assigned automatically. Sign-out/account-switch cleanup removes these legacy keys.
- Aptitude/discussion history and the GitHub username are scoped to the account on the device,
  validated before rendering, and cleared on sign-out/account switch. These histories are not synced.
- Aptitude and discussion timers use deadlines, including focus/visibility catch-up. If a tab sleeps
  through both discussion phases, it opens review when resumed. Aptitude saves a result once even
  if several expiry events arrive together. In-progress practice sessions do not survive a reload.
- GitHub imports read up to three pages (300 repositories), deduplicate, label partial responses or
  the import cap, and support cancellation. Late responses cannot replace a cancelled/newer import.
  The loaded account is labelled and selections are limited to five. Profile/repository URL checks
  reject lookalike hosts, credentials and private entries; malformed dates are omitted.
- Imported repository descriptions do not claim that the candidate built the project. Candidates
  must describe their own contribution and verified results. Career-gap text no longer assumes
  that a health condition resolved, a layoff was company-wide, or skills were maintained.
- Shared output blocks offer a text download and a persistent retry message when clipboard access
  fails. The output wraps on narrow screens.

## Validation

- API workspace tests: 5 passed, including three tool contracts, ownership, compare-and-swap conflicts,
  invalid fields/limits and account export.
- Focused web unit tests: 10 passed (workspace boundaries, deadline transitions, draft/history
  validation, browser cleanup, honest output and GitHub parsing/pagination/partial failures/abort).
- Chromium browser tests: 4 passed against a fresh disposable SQLite database with mock providers.
  Scenarios cover saved draft reload, two-tab conflicts and other-account isolation; blocked clipboard
  download and 390px layout; background clock jumps and a single aptitude score; GitHub pagination,
  selection limits and cancellation. GitHub responses were intercepted, not fetched live.
- Web typecheck, production build, lint and API Ruff/mypy passed.
  Web lint retains the three existing hook warnings in SupportChat, SessionSetup and InterviewRounds.

## Remaining coverage

Real GitHub API network/rate-limit behavior, actual multi-device sync, non-Chromium browsers,
assistive-technology navigation, long-running mobile background suspension and the rest of the
product's paid/provider integrations need dedicated validation. Nothing in this batch sends job
applications, makes purchases, or deploys production changes.
