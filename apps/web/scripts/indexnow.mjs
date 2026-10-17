#!/usr/bin/env node
// Tells the IndexNow search engines (Bing, Yandex, Naver, Seznam, Yep; one submission reaches them all) which
// orbitanswer.com pages changed, so they recrawl them within minutes instead of days. Google doesn't take IndexNow;
// it reads the sitemap. DECISIONS D67, docs/SEO.md.
//
//   node apps/web/scripts/indexnow.mjs /warmup /companies/tcs           # dry run: prints what it would send
//   node apps/web/scripts/indexnow.mjs --sitemap https://orbitanswer.com/sitemap.xml --since 2026-10-18 --send
//   node apps/web/scripts/indexnow.mjs --sitemap https://orbitanswer.com/sitemap.xml --all --send   # first time only
//
// Run it AFTER a deploy (the key file has to be live): it checks https://orbitanswer.com/<key>.txt first and stops if
// the file isn't there. Without --send nothing leaves the machine but that check. Submit changed pages only: the
// engines ask that unchanged pages aren't sent again. Removed or redirected pages may be sent too.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SITE = "https://orbitanswer.com";
export const ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_FILE = /^[0-9a-f]{32}\.txt$/;
const MAX_URLS = 10_000;

/** The key: INDEXNOW_KEY, else the one <32 hex>.txt file in apps/web/public (which the site serves at /<key>.txt). */
export function readKey(publicDir, env = process.env) {
  if (env.INDEXNOW_KEY) return env.INDEXNOW_KEY.trim();
  const files = readdirSync(publicDir).filter((f) => KEY_FILE.test(f));
  if (files.length !== 1) throw new Error(`expected one IndexNow key file in ${publicDir}, found ${files.length}`);
  const key = readFileSync(join(publicDir, files[0]), "utf8").trim();
  if (`${key}.txt` !== files[0]) throw new Error(`${files[0]} doesn't contain its own name`);
  return key;
}

/** Every <loc> in a sitemap (or sitemap index), with its <lastmod> if it has one. */
export function sitemapEntries(xml) {
  return [...xml.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/g)].map((m) => ({
    loc: (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1] ?? null,
    lastmod: (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) || [])[1] ?? null,
    isSitemap: m[0].startsWith("<sitemap>"),
  })).filter((e) => e.loc);
}

/** The pages changed on or after `since` (YYYY-MM-DD), by their lastmod. Pages without a lastmod aren't picked. */
export const changedSince = (entries, since) => entries.filter((e) => e.lastmod && e.lastmod.slice(0, 10) >= since).map((e) => e.loc);

/** Absolute addresses on the site, de-duplicated; anything on another host is refused (the engines answer 422). */
export function normalise(urls, site = SITE) {
  const host = new URL(site).host;
  const out = [];
  for (const raw of urls) {
    const u = new URL(raw, `${site}/`);
    if (u.host !== host) throw new Error(`${raw} is not on ${host}`);
    u.hash = "";
    if (!out.includes(u.href)) out.push(u.href);
  }
  return out;
}

/** The POST bodies (at most 10,000 addresses each). */
export function payloads(urls, key, site = SITE) {
  const host = new URL(site).host;
  const out = [];
  for (let i = 0; i < urls.length; i += MAX_URLS) {
    out.push({ host, key, keyLocation: `${site}/${key}.txt`, urlList: urls.slice(i, i + MAX_URLS) });
  }
  return out;
}

export const RESPONSES = {
  200: "accepted",
  202: "accepted; the key is still being checked",
  400: "bad request (the format)",
  403: "key not valid (the key file isn't live, or doesn't match)",
  422: "an address isn't on this host, or the key doesn't match it",
  429: "too many requests: try again later",
};

async function fetchText(source, fetchImpl) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetchImpl(source, { headers: { "user-agent": "orbit-indexnow/1" } });
    if (!res.ok) throw new Error(`${source}: ${res.status}`);
    return res.text();
  }
  return readFileSync(source, "utf8");
}

export async function main(argv, { fetchImpl = fetch, log = console.log, env = process.env } = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = { urls: [], send: false, all: false, since: null, sitemap: null, endpoint: ENDPOINT, site: SITE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send") args.send = true;
    else if (a === "--all") args.all = true;
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--sitemap") args.sitemap = argv[++i];
    else if (a === "--endpoint") args.endpoint = argv[++i];
    else if (a === "--site") args.site = argv[++i].replace(/\/+$/, "");
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else args.urls.push(a);
  }
  const key = readKey(join(here, "..", "public"), env);
  let urls = [...args.urls];
  if (args.sitemap) {
    let entries = sitemapEntries(await fetchText(args.sitemap, fetchImpl));
    // A sitemap index: read each sitemap it lists.
    for (const child of entries.filter((e) => e.isSitemap)) entries.push(...sitemapEntries(await fetchText(child.loc, fetchImpl)));
    entries = entries.filter((e) => !e.isSitemap);
    if (args.all) urls.push(...entries.map((e) => e.loc));
    else if (args.since) urls.push(...changedSince(entries, args.since));
    else throw new Error("with --sitemap, say which pages: --since YYYY-MM-DD (changed pages) or --all (first submission)");
  }
  urls = normalise(urls, args.site);
  if (!urls.length) {
    log("Nothing to submit.");
    return 0;
  }
  const bodies = payloads(urls, key, args.site);
  if (!args.send) {
    log(`Dry run (add --send to submit) to ${args.endpoint}:`);
    for (const b of bodies) log(JSON.stringify(b, null, 2));
    return 0;
  }
  // The engines fetch the key file to check the submission is ours: make sure it's live first.
  const keyUrl = `${args.site}/${key}.txt`;
  const live = await fetchImpl(keyUrl, { headers: { "user-agent": "orbit-indexnow/1" } });
  const text = live.ok ? (await live.text()).trim() : "";
  if (text !== key) {
    log(`Stopped: ${keyUrl} answered ${live.status}${live.ok ? " without the key" : ""}. Deploy first, then submit.`);
    return 1;
  }
  let failed = 0;
  for (const body of bodies) {
    const res = await fetchImpl(args.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "user-agent": "orbit-indexnow/1" },
      body: JSON.stringify(body),
    });
    log(`${res.status} ${RESPONSES[res.status] ?? ""}: ${body.urlList.length} address(es)`);
    if (res.status !== 200 && res.status !== 202) failed++;
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(String(e.message || e));
      process.exit(2);
    },
  );
}
