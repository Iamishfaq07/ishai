import { cleanText, jobFromJsonLd, jobFromTitle, type ClippedJob } from "../lib/job";

const MAX_DESCRIPTION = 20_000;

function meta(name: string): string {
  const el = document.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`);
  return el?.content.trim() ?? "";
}

/** The job on this page, from what's already on screen: structured data first, then the page's own text. Nothing
 * is fetched; the person checks and edits it before it's saved. */
export function extractJob(): ClippedJob {
  const url = location.href;
  const blobs = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? "");
  const structured = jobFromJsonLd(blobs, url);
  if (structured && structured.title) return structured;
  const selection = window.getSelection()?.toString().trim() ?? "";
  const main = document.querySelector("main, [role=main], article") ?? document.body;
  const description = cleanText(selection || (main as HTMLElement).innerText || "").slice(0, MAX_DESCRIPTION);
  const h1 = document.querySelector("h1")?.textContent?.trim() ?? "";
  const fromTitle = jobFromTitle(meta("og:title") || document.title, meta("og:site_name") || location.hostname);
  return { title: h1 || fromTitle.title, company: fromTitle.company, location: "", url, description };
}
