# Isolated previews and staging

## Code behavior

Production remains the default `orbit` Worker. `wrangler.jsonc` has explicit preview and named staging vars, both with an empty API_URL. They answer 503 for API and employer rendering until configured with an independent HTTPS API. The browser also rejects the canonical production direct REST/live URLs on nonproduction origins. Do not substitute a production Railway origin/alias to bypass the guard.

Cloudflare references checked 20 October 2026: [preview configuration](https://developers.cloudflare.com/workers/previews/configuration/), [environments and noninherited vars/secrets](https://developers.cloudflare.com/workers/wrangler/environments/). Account-specific Workers Builds commands/settings are OWNER ACTION and were not changed by this PR.

## Required operator setup (not provisioned by code)

1. Provision a separate Railway service and disposable Neon database/branch with no production-data copy. Use synthetic fixtures. Keep one API replica as required by current live-session state.
2. Use an owned **separate registrable domain** for staging web/API, protected with Access. A mere subdomain of orbitanswer.com can receive existing parent-domain production cookies. Do not use it for signed-in staging. Set ORBIT_WEB_URL, exact CORS origins and ORBIT_COOKIE_DOMAIN for this isolated domain, never orbitanswer.com.
3. Generate separate staging JWT/config/proxy/encryption credentials; do not copy production secrets. Configure SMTP sandbox/test recipients, independent Google OAuth app and exact callback. Restrict sign-up to test accounts. Keep hosted execution off; no production ATS credentials or worker tokens.
4. Use Razorpay test credentials/webhook and PayPal sandbox app/webhook. Never reuse live billing keys or provider transports for ordinary fixture tests. Mock providers are appropriate in local test mode; a production-mode staging service must meet existing real-provider startup requirements and separately metered smoke needs approval.
5. Set the named staging API_URL to its isolated HTTPS origin and put its PROXY_SECRET with `wrangler secret put PROXY_SECRET --env staging`. Match only that service's ORBIT_PROXY_SECRET. Preview-specific secrets must also be configured independently if previews are enabled for signed-in tests; named environments do not imply preview secret inheritance.
6. Build client **and** SSR with preview mode (from apps/web): `pnpm exec tsc -p tsconfig.json`, `pnpm exec vite build --mode preview`, `pnpm exec vite build --mode preview --ssr src/prerender/entry.tsx`, `node scripts/prerender.mjs`. Set VITE_LIVE_URL to the independent staging API when testing live WebSockets; otherwise it stays same-origin. Leave VITE_API_DIRECT_URL empty. The regular build remains production mode.
7. Preview the staged artifact/config; explicitly verify network destinations, cookies, OAuth redirects and payment webhooks before signing in. Test migrations up/down/up and restore on the disposable database, then the golden fixture journeys. Never deploy staging assets as the production build.
8. Set separate error reporting and retention controls. Do not put raw resumes, transcripts, messages or tokens in logs/analytics. Confirm no staging request reaches production using operator network/log evidence.

## Rollout and recovery

This PR creates no resources and deploys nothing. Until setup is complete, **preview sign-in is intentionally unavailable**; static previews and local fixture development still work. Production behavior on orbitanswer.com is preserved. If isolation fails, disable preview access and correct bindings/builds; do not point preview at production as a workaround. Rotate any exposed credentials and follow the existing incident runbook.
