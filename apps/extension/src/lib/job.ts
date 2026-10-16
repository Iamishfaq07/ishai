/** A job read from the page the person is looking at, for them to check and edit before it's saved. */
export interface ClippedJob {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
}

const MAX_DESCRIPTION = 20_000;

/** Text without tags, entities collapsed and whitespace tidied (JSON-LD descriptions are often HTML). */
export function cleanText(html: string): string {
  return html
    .replace(/<\/?(b|i|em|strong|span|a|u|small|mark|code)\b[^>]*>/gi, "") // inline: no space ("<b>Python</b>,")
    .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isJobPosting(o: Json): boolean {
  const t = o["@type"];
  return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
}

/** Every object in a JSON-LD blob, through @graph and arrays. */
function objects(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value && typeof value === "object") {
    const o = value as Json;
    return [o, ...objects(o["@graph"])];
  }
  return [];
}

function place(loc: unknown): string {
  const first = Array.isArray(loc) ? loc[0] : loc;
  if (!first || typeof first !== "object") return str(first);
  const address = (first as Json).address;
  if (address && typeof address === "object") {
    const a = address as Json;
    return [str(a.addressLocality), str(a.addressRegion), str(a.addressCountry)].filter(Boolean).join(", ");
  }
  return str((first as Json).name);
}

/**
 * The job from schema.org JobPosting data (most job boards and company career sites publish it for search engines):
 * null when the page has none.
 */
export function jobFromJsonLd(blobs: string[], url: string): ClippedJob | null {
  for (const blob of blobs) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(blob);
    } catch {
      try {
        // Some sites publish raw line breaks inside JSON strings, which JSON.parse refuses: as spaces, it parses.
        // eslint-disable-next-line no-control-regex -- control characters are exactly what's being replaced
        parsed = JSON.parse(blob.replace(/[\u0000-\u001F]+/g, " "));
      } catch {
        continue;
      }
    }
    const posting = objects(parsed).find(isJobPosting);
    if (!posting) continue;
    const org = posting.hiringOrganization;
    const company = org && typeof org === "object" ? str((org as Json).name) : str(org);
    const remote = str(posting.jobLocationType).toUpperCase() === "TELECOMMUTE";
    const location = place(posting.jobLocation) || (remote ? "Remote" : "");
    return {
      title: str(posting.title),
      company,
      location,
      url: str(posting.url) || url,
      description: cleanText(str(posting.description)).slice(0, MAX_DESCRIPTION),
    };
  }
  return null;
}

/** "Senior Engineer - Acme | LinkedIn" → title and company, from a page title, when nothing better exists. */
export function jobFromTitle(pageTitle: string, siteName: string): Pick<ClippedJob, "title" | "company"> {
  const cleaned = pageTitle.replace(/\s*[|·–-]\s*(LinkedIn|Naukri\.com|Naukri|Indeed|Glassdoor|Wellfound)\s*$/i, "").trim();
  const at = cleaned.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (at) return { title: at[1]!.trim(), company: at[2]!.trim() };
  const parts = cleaned.split(/\s+[|·–-]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0]!, company: parts[1]! };
  return { title: cleaned, company: siteName.trim() };
}
