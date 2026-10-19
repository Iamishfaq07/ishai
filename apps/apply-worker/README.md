# Personal Orbit hosted apply worker

Runs approved external employer applications without the candidate's browser or extension. Start with
[`docs/HOSTED_APPLY.md`](../../docs/HOSTED_APPLY.md) for deployment, coverage, consent and recovery.

```sh
pnpm install --frozen-lockfile
pnpm --filter @orbit/apply-worker exec playwright install chromium
pnpm --filter @orbit/apply-worker build
# Supply ORBIT_API_URL and ORBIT_APPLY_WORKER_SECRET through the process environment, never the browser build.
pnpm --filter @orbit/apply-worker start
```

One context per application; no shared cookies or job-site passwords. All Chromium traffic goes through the
public-IP-only CONNECT proxy; Orbit's authenticated control channel stays outside the page. Receipts are encrypted
on disk and replayed independently of the browser. Workers may be replicated: the API serialises candidate leases.

Tests:

```sh
pnpm --filter @orbit/apply-worker typecheck
pnpm --filter @orbit/apply-worker test
pnpm --filter @orbit/apply-worker test:browser
```

`src/browser.test.mjs` uses real Chromium and intercepted fake employer pages; it cannot submit a real application.
`src/adapters.test.ts` also reads sanitised public Workable and Recruitee DOM fixtures recorded on 2026-10-19.
The read-only recorder is `scripts/record-forms.mjs`. These demonstrate browser behaviour and form recognition, not
live employer acceptance. Workday's public Apply Manually entry was inspected; sign-in gates still need the person.

## Deployment policy attribution

`seccomp_profile.json` is Microsoft Playwright's Docker policy from commit
`ae935a43d9e376e4759548f6b3c6905c7b282333`, under Apache-2.0 (`LICENSE.seccomp`). Chromium sandboxing is enabled
in the worker. Use the supplied Compose configuration on a Linux host that permits its user namespaces; do not
disable the sandbox to fit a restricted hosting platform. Browser child processes receive no worker credentials.
