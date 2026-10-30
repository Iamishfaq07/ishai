# Hosted personal Orbit Apply

## Candidate cycle

Welcome → Career journey → upload/build resume → confirm Jobs AI preferences → approve the master resume and
reusable answers → choose limits, quiet hours and Automatic/Review first → choose Hosted and authorise it →
save and run the first search → scheduled matching/planning → hosted applications → confirmation receipts and
the Jobs tracker → Saba interview practice for that role → track interviews, offers and hired outcomes.

The existing Jobs AI feed continues discovering matches. The planner runs every three hours through the API's
sweeper; the first setup save also plans immediately. Existing aggregator listings can resolve to the newly
recognised employer application URLs. This change does not add a Workday job-board crawler or automate LinkedIn,
Indeed or Naukri. Interviews, offers and hired statuses for external employers are maintained by the candidate;
there is no claim that Orbit can guarantee an interview or a hiring outcome.
The default "Pause automatically when I mark a role as hired" setting stops this campaign at that outcome.
An explicit Resume starts a new campaign, so an older hired role does not block a later search.

## No extension in the candidate flow (21 Oct 2026)

Auto-apply no longer offers or asks for the browser extension. Setup has one way to send: hosted, wherever this server
runs it (`ORBIT_HOSTED_APPLY`). Where it doesn't, Orbit still finds matches and prepares every application, and each
approved external one becomes a ready-to-send kit in Needs you (`auto_apply/handoff.py`): the employer form link,
the prepared answers to copy, the cover letter and the tailored resume PDF, then "I sent it · mark applied"
(`POST /v1/apply/packets/{id}/done`, never charged). The web app shows the kit at once; the server moves the packet to
`handoff` after a 30-minute grace (so an extension connected minutes ago can still claim it), and the existing
"needs you" email covers it. Orbit Business applications are sent by the API as before. Accounts still in browser
mode with an extension that asked for work in the last two days keep it; the extension pages remain for them.

## Coverage and boundaries

- Browser extension: existing Greenhouse, Lever and Ashby coverage.
- Hosted: those three plus Workday, SmartRecruiters, Workable and Recruitee hosted employer forms.
- Workday: recognised `*.wdN.myworkdayjobs.com` and `*.wdN.myworkdaysite.com/recruiting/` job URLs, Apply Manually,
  approved fields, resume uploads, country dropdowns, multi-step Next/Review navigation and final submission.
  An account-required or SSO application stops for the candidate. No passwords are stored, accounts created,
  authenticated sessions imported or email codes fetched. Many Workday employers require accounts, so this is
  conditional form automation, not universal unattended Workday coverage.
- SmartRecruiters: public `jobs.smartrecruiters.com` forms. Its human/anti-abuse challenges are handed off.
- Workable: named employer and short `/j/<ref>` links, `/apply/` forms, accessible field labels and radio groups.
- Recruitee: hosted employer subdomains and the actual `offer-application-form`, including its Send button.
- Custom company domains, embedded cross-origin application frames, unsupported widgets, changed forms, missing
  required answers, captchas, email verification and logins return to Needs you. The first three hosted adapters
  use the existing page engine, and all new adapters use its truthful answer and stop rules.
- Adapters are covered by fixture tests. No real candidate application was submitted during development. A site
  showing confirmation is the worker's evidence; an ATS can still silently discard an application after that.

## Quick setup on a free Ubuntu server (Oracle Cloud Always Free or any VPS)

On an Ubuntu 22.04/24.04 server (x86 or ARM; 1 CPU and 6 GB memory is enough), signed in over SSH:

```sh
curl -fsSL https://raw.githubusercontent.com/Iamishfaq07/ishai/main/deploy/setup-apply-worker.sh -o setup.sh
bash setup.sh
```

It installs Docker, clones the repository, asks for the API address (default `https://api.orbitanswer.com`) and
creates the worker secret, saves both in `deploy/apply-worker.env` (readable by that user only, never committed),
and starts the worker with the Compose file below. Then, on the API (Railway → API service → Variables), set
`ORBIT_HOSTED_APPLY=true` and `ORBIT_APPLY_WORKER_SECRET` to the same secret, and redeploy. `bash setup.sh` again
updates the worker; `bash setup.sh status`, `logs` and `stop` do what they say. No inbound port needs opening.

## Owner deployment (after PR review)

1. Deploy the API with migration `47b9e3d0a6f2` (`alembic upgrade head`). Existing accounts remain in browser mode.
2. Generate a separate random secret, at least 32 characters. Set on the API:
   - `ORBIT_HOSTED_APPLY=true`
   - `ORBIT_APPLY_WORKER_SECRET=<secret>`
3. Build a separate background worker from the repository root:
   `docker build -f apps/apply-worker/Dockerfile -t orbit-personal-apply .`
4. On the worker set `ORBIT_API_URL=https://<your API origin>` and the identical
   `ORBIT_APPLY_WORKER_SECRET`. No JWT secret, database credentials or candidate sessions belong on the worker.
   `ORBIT_APPLY_OUTBOX=/data/receipts` is the default; mount persistent storage at `/data` writable by image user
   `orbitapply` (UID 10001). Use a Linux host that permits Chromium user-namespace sandboxing; it is explicitly
   enabled and never silently disabled. The supplied `deploy/hosted-apply.compose.yaml` sets the unprivileged user,
   shared memory, limits, persistent receipt volume and Playwright's reviewed seccomp profile. Set
   `ORBIT_APPLY_SECCOMP_PROFILE` to the absolute path of `apps/apply-worker/seccomp_profile.json`, then run
   `docker compose -f deploy/hosted-apply.compose.yaml up -d --build`. No public worker port is needed. A managed
   platform that cannot supply the required sandbox policy is not a supported worker host; the API can stay there.
5. Give the API and worker continuous runtime: an API suspended when no visitor has a page open cannot plan jobs.
   Each worker executes one application at a time, with server-side per-candidate and per-company pacing.
6. Confirm a heartbeat: `/v1/apply/setup` must return `hosted_enabled=true, hosted_online=true` for a signed-in
   account. The UI explicitly says waiting while no worker has checked in for 90 seconds. Deployment alone never
   opts a candidate in. They must verify email, approve the resume and explicitly authorise Hosted in setup.
7. Review the new public privacy wording and extension release separately. Hosted applying does not require the
   extension to be published. The Dockerfile installs Chromium directly from the locked Playwright package.

No hosted provider purchase, production deployment, secret rotation or real job submission is performed by this PR.
Docker was unavailable on the development host, so image build and Linux sandbox startup are separate CI gates;
they must pass in a Docker environment before deployment.

## Private worker protocol

All routes below require `X-Orbit-Worker-Secret`. They do not accept a normal Orbit session as worker authority.
The prefix is `/v1/internal/apply`:

- `POST /heartbeat {worker_id}`: pool liveness; stale heartbeats are removed.
- `POST /next {worker_id}`: 204 or `{token, packet}`. Only separately consented, unpaused, verified, eligible
  personal accounts are polled. The existing account lock, daily/tenant/company caps, site kill switches, quiet
  hours, quota holds and lease constraints apply. Browser mode and hosted mode cannot claim the same queue.
- `GET /<id>/resume.pdf` with `X-Orbit-Attempt`: only this lease's PDF; the page never receives the service secret.
- `POST /<id>/check {token}`: recheck the lease, account status, consent, approved master hash and site availability.
- `POST /<id>/questions {token,questions}`: resolve newly revealed required questions against the confirmed profile,
  bank and approved resume context. No invented answer or LLM guess. Missing answers are sent back to the candidate.
- `POST /<id>/submit {token}`: commit a one-time submission checkpoint before the final browser click. Repeating
  this call is refused. Pause, revocation, resume edits, quiet hours, suspension and kill switches stop submission.
- `POST /<id>/result {token,result}`: store proof, update tracker/resume snapshot and charge only a confirmed
  submission. Repeated receipts for an already recorded attempt return the saved outcome without another charge.

An approval fingerprint covers the master resume, confirmed facts, answer bank, filters, threshold, disclosure and
review mode. Queued packets with stale fingerprints are rebuilt against current matching rules before another
attempt. Changes during filling stop the old attempt before submission; unsent packets can then rebuild. Review
mode still waits for packet approval, and excluded jobs become skipped. Quiet hours and reduced daily limits are
checked live before the final click.

Tokens are fenced per attempt and omitted from personal data exports. A worker never reuses a candidate's browser
context for another application. HTTPS navigation stays on the leased employer host; a CONNECT proxy rejects
private/reserved/metadata addresses and pins checked DNS addresses before tunnelling TLS to prevent DNS rebinding.
There is no general purpose browser execution endpoint or LLM with unrestricted browser authority.
The browser child process receives only an allowlist of OS paths and locale variables, never the parent worker's
Orbit secret or provider credentials. The seccomp profile is from
[Microsoft Playwright](https://github.com/microsoft/playwright/blob/ae935a43d9e376e4759548f6b3c6905c7b282333/utils/docker/seccomp_profile.json),
under Apache-2.0; its license is included in `apps/apply-worker/LICENSE.seccomp`. One change from it: `chroot` is
allowed without `CAP_SYS_CHROOT`. Playwright's profile assumes a container that keeps the default capabilities; this
worker drops all of them, and Chromium's sandbox chroots inside the user namespace it creates, where the kernel still
requires the capability. Without the change the sandbox can't start (`Check failed: sys_chroot("/proc/self/fdinfo/")`).

## Failure recovery and rollback

The API commits `submission_started_at` before the click. A crash before that checkpoint may retry under the normal
lease rules. A crash afterwards moves to Needs you rather than ready: the candidate must check the employer and
explicitly confirm it was not submitted before trying again. A valid late receipt can reconcile the fenced attempt
within the receipt grace period. A receipt retry never opens a browser or repeats submission.

Receipts queued on disk use AES-256-GCM derived from the worker secret, are written atomically, and are deleted after
API acknowledgement or a final stale-attempt rejection. Keep `/data` persistent and drain it before rotating the
secret; otherwise old encrypted receipts need manual recovery with the old key. Candidate account deletion cascades
API packets/proofs, and outbox delivery then receives 404 and deletes its local encrypted receipt.

Disable `ORBIT_HOSTED_APPLY` to stop worker API access. Existing applications remain visible and the UI shows hosted
unavailable; candidates can choose Browser. Stop the worker before schema downgrade, reconcile in-flight attempts,
and retain the encrypted outbox until receipts have been resolved. The migration can then be downgraded.
