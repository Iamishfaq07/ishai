// Loads the saved ATS application pages (tools/e2e/ats-fixtures, recorded once from public postings) into jsdom.
// Only the stylesheet rules that hide things are kept: jsdom has no layout and big stylesheets make it crawl.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../../../tools/e2e/ats-fixtures");

export type FixtureName = "greenhouse-gitlab" | "greenhouse-discord" | "lever-palantir" | "lever-spotify" | "ashby-linear" | "ashby-notion";

function hidingRules(css: string): string {
  const out: string[] = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of noComments.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const body = m[2]!;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(body)) out.push(`${m[1]!.trim()}{${body.match(/(display\s*:\s*none|visibility\s*:\s*hidden)[^;]*/g)!.join(";")}}`);
  }
  return out.join("\n");
}

export function fixtureHtml(name: FixtureName): string {
  return readFileSync(join(DIR, `${name}.html`), "utf8");
}

export function loadFixture(name: FixtureName | { html: string; url: string }, url?: string): JSDOM {
  const html = typeof name === "string" ? fixtureHtml(name) : name.html;
  const href = typeof name === "string" ? (url ?? URLS[name]) : name.url;
  const slim = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_all, attrs: string, css: string) => `<style${attrs}>${hidingRules(css)}</style>`);
  // A quiet console: the recorded CSS has rules jsdom can't parse, which is fine here.
  return new JSDOM(slim, { url: href, pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
}

export const URLS: Record<FixtureName, string> = {
  "greenhouse-gitlab": "https://job-boards.greenhouse.io/gitlab/jobs/8860302002",
  "greenhouse-discord": "https://job-boards.greenhouse.io/discord/jobs/8806482002",
  "lever-palantir": "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply",
  "lever-spotify": "https://jobs.lever.co/spotify/223f9722-3579-4ff2-b123-e4cc7b0c1a64/apply",
  "ashby-linear": "https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff/application",
  "ashby-notion": "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application",
};
