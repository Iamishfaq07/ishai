# Web search without a vendor API key

Personal Orbit can use [SearXNG](https://github.com/searxng/searxng), an open-source
metasearch service. It requires no Brave account or search API key. You operate a
search service; hosting resources still have a cost unless you already have capacity.
SearXNG is AGPL-3.0 software run as a separate, unmodified service. Orbit's connector
uses its documented HTTP API; no SearXNG source has been copied into Orbit.

## Local API or API on the same Docker host

From the repository root, generate a local signing secret (not a vendor API key),
then start the supplied private service. PowerShell:

```powershell
$env:ORBIT_SEARCH_SERVICE_SECRET = (apps/api/.venv/Scripts/python.exe -c "import secrets; print(secrets.token_hex(32))")
docker compose -f deploy/contact-search.compose.yaml up -d
```

Set this in `apps/api/.env` and restart the API:

```dotenv
ORBIT_CONTACT_SEARXNG_URL=http://127.0.0.1:8888
```

The compose service binds only to localhost. The supplied `settings.yml` enables JSON
and disables the public-instance interface. It is for Orbit's server, not an open
public search proxy. The image is pinned to upstream tag `2026.10.19-81371861f` and its registry
digest, matching the inspected source commit. Review upstream updates before
changing that pin. Preserve the locally generated signing
secret in your deployment environment before restarting/recreating the service.

## API inside a container or hosted separately

Use a private service address reachable **from the API**, for example
`http://searxng:8080`, after placing both services on the same private network. Inside
an API container, `127.0.0.1` is the API itself, not the search container.

For Render, run the official SearXNG container as a private service, mount the supplied
settings at `/etc/searxng/settings.yml`, and set `SEARXNG_SECRET` to a locally generated
value, `SEARXNG_BIND_ADDRESS=0.0.0.0`, `SEARXNG_PORT=8080` and `FORCE_OWNERSHIP=false`
when the settings mount is read-only. Set `ORBIT_CONTACT_SEARXNG_URL` on the API to
that private service's address. Apply those settings only with the owner's deployment
approval. No changes in this PR provision or deploy a production service.

## Behavior and limits

- A configured SearXNG URL takes precedence over the existing optional Brave key.
  SearXNG requests contain no Brave credential. There is no silent paid-provider fallback.
- Only the server operator sets this endpoint. Candidates cannot supply a search-service
  URL. Private HTTP is allowed for service-to-service networking; external HTTPS works too.
- No endpoint credentials, URL query/fragment, redirects or environment proxies.
- One query per explicit contact research run, first five result rows, 400 KB maximum
  response, eight-second I/O timeout and ten-second total search deadline.
- Only employer and job-title terms enter the search query. Candidate resumes, names
  and email addresses are not query inputs. Upstream engines still receive search terms.
- Research retains the existing verified-account guard, durable five-run daily quota,
  source quotes, candidate review and explicit contact capture.
- Search-service errors, rate limits or disabled JSON preserve other supplied evidence
  and show an availability message. Empty results are valid; no identities are invented.
- Public community instances are not automatically selected or rotated. Many disable
  JSON or limit automated requests, so use an instance you operate or have permission to use.

## Verify after deployment

Request `/search?q=example&format=json` directly from the API host and confirm a JSON
`results` array. In Personal Orbit, save a job, open **Career launchpad → Apply & connect
→ Contacts & outreach**, and request public-web research. The context endpoint reports
`web_search_provider: "searxng"` without exposing the service URL or credentials.
Check actual result source links; a configured endpoint alone does not prove it is healthy.

This workspace has no Docker runtime or production service access. Connector behavior
is tested with bounded HTTP fixtures, including provider errors and redirects; the
container itself and live upstream search must be verified on the deployment host.

Primary references inspected at upstream commit `81371861f67226091d1c4df2e3908a11d3b54eb9`:
[Search API](https://docs.searxng.org/dev/search_api.html),
[container installation](https://docs.searxng.org/admin/installation-docker.html),
[settings](https://docs.searxng.org/admin/settings/settings_search.html),
[license](https://github.com/searxng/searxng/blob/81371861f67226091d1c4df2e3908a11d3b54eb9/LICENSE).


## Automatic workflow / DeepSeek fallback (2026-10-21, unverified)

Managed SearXNG remains first priority. If neither SearXNG nor Brave is configured, the finder can use the existing effective server DeepSeek key with official Search API; this is provider-billed, not keyless/free search. Automatic mode performs up to three queries per deliberate run. Set ORBIT_CONTACT_DEEPSEEK_SEARCH=false to disable fallback. [Setup, limits and deferred checks](implementation/AUTOMATIC_JOB_CONTACT_FINDER.md). No live provider checks were run.
