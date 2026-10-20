# Release observations — 20 October 2026

## Fresh read-only evidence

- Source main: `9c39e6015585804cd0313a5f025d7888040279cf`, merge of PR437. This increment starts there.
- `GET https://api.orbitanswer.com/health`: HTTP200, status ok, commit `9c39e60`, Server `railway-hikari`, no cf-ray header.
- `GET https://api.orbitanswer.com/ready`: HTTP200, database ok, proxy_secret ok. These are liveness/readiness checks, not a load, provider or billing test.
- `GET https://orbitanswer.com` from Python: HTTP403. Signed-in deployed web behavior is NOT VERIFIED; this is not proof that ordinary browser access is down.
- Main CI run `39435380739`: jobs marked failure without execution. Fresh API check `118670900625` annotation states payments failed or spending limit needs increasing. GitHub billing is OWNER ACTION.
- Source configs/docs describe Cloudflare web + Railway API + Neon. Railway dashboard plan/region/capacity, Neon restore and account settings were not accessible/verified here.

## Corrections to older reports

The 16 October LAUNCH_SIGNOFF was historical; its Render-free and unpromoted-Cloudflare claims are not today's deployment evidence. Readiness now answers successfully with proxy_secret ok. Do not prescribe a Render plan change or declare deployed proxy trust missing from that report.

The web default installer remains `https://orbit-downloads.ishfaq.workers.dev/Orbit-Setup.exe` (`lib/desktop.ts`); VITE_DESKTOP_DOWNLOAD_URL can override it. No override/signature was independently observed. Updater signatures are not Authenticode. Windows stays beta until code-signing and real installation checks pass.

## Unverified operator gates

CI execution; isolated staging provisioning; staging/Postgres migration and backup/restore evidence; provider failover/live audio; production billing sandbox/live approval; Railway capacity/load; Windows device/installer/updater; extension store/package; counsel policy decisions. See the current personal-orbit sign-off for this increment. Do not carry old PASS counts forward as fresh results.

## Repeat this observation

Run `python tools/release/personal_orbit_report.py --output observations.json` for source and tool availability only; add `--public-read-only` for one health and readiness GET each. It does not execute tests, enumerate secrets, deploy, or certify release targets. Attach fresh test logs separately and recheck current CI annotations.
