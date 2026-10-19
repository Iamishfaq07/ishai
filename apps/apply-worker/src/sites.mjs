export const SITES = ["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "workable", "recruitee"];

/** Browser processes need OS paths/locales, never the parent worker's API credentials. */
export function browserEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([key, value]) => value !== undefined &&
    /^(PATH|HOME|TMPDIR|TEMP|TMP|SYSTEMROOT|WINDIR|LOCALAPPDATA|USERPROFILE|COMSPEC|FONTCONFIG_PATH|LANG|LC_ALL|TZ|DISPLAY|PLAYWRIGHT_BROWSERS_PATH)$/i.test(key)));
}

/** The worker opens only recognised employer application URLs, with no credentials or alternate ports. */
export function applicationUrl(raw, ats) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname, p = u.pathname;
    const allowed = {
      greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io"].includes(h) && /^\/[\w.-]+\/jobs\/\d+/.test(p),
      lever: ["jobs.lever.co", "jobs.eu.lever.co"].includes(h) && /^\/[\w.-]+\/[0-9a-f-]{36}\/apply\/?$/.test(p),
      ashby: h === "jobs.ashbyhq.com" && /^\/[\w.-]+\/[0-9a-f-]{36}\/application\/?$/.test(p),
      workday: (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(h) && p.includes("/job/") || /^[a-z0-9-]+\.wd\d+\.myworkdaysite\.com$/.test(h) && p.startsWith("/recruiting/")) && /\/apply\/?$/.test(p),
      smartrecruiters: h === "jobs.smartrecruiters.com" && /^\/[\w.-]+\/\d+(?:-[^/]*)?\/?$/.test(p),
      workable: h === "apply.workable.com" && /^\/(?:[\w-]+\/)?j\/[A-Za-z0-9]+\/apply\/?$/.test(p),
      recruitee: /^[a-z0-9-]+\.recruitee\.com$/.test(h) && /^\/o\/[\w-]+\/c\/new\/?$/.test(p),
    }[ats];
    return allowed ? u : null;
  } catch { return null; }
}

/** Navigation is confined to this application's employer host. Subresources use the public-IP-only proxy. */
export function sameEmployer(raw, origin) {
  try { const u = new URL(raw); return u.protocol === "https:" && u.origin === origin && !u.username && !u.password; }
  catch { return false; }
}

/** Before final submission, even a same-host redirect must keep the original job identity. */
export function sameApplication(raw, original, ats) {
  if (!sameEmployer(raw, original.origin)) return false;
  const path = new URL(raw).pathname;
  if (ats === "workable") {
    const ref = original.pathname.match(/\/j\/([A-Za-z0-9]+)(?:\/|$)/)?.[1];
    return !!ref && path.split("/").some((part, i, parts) => parts[i - 1] === "j" && part === ref);
  }
  const base = original.pathname.replace(/\/(apply|application|c\/new)\/?$/, "");
  return path === base || path.startsWith(`${base}/`);
}
