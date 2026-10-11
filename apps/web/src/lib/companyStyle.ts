import type { CompanyStyle, CreateSessionRequest } from "@orbit/types";

const SUFFIXES = new Set(["ltd", "limited", "inc", "pvt", "private", "llc", "corp", "corporation", "co"]);

/** "Tata Consultancy Services Ltd." → "tata consultancy services" (as the server's company_styles._key). */
export function companyKey(name: string): string {
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  while (words.length && SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

/** The guide for a typed company, by name or alias ("AWS" is Amazon), or by a known name leading it ("Google Cloud
 *  India"); the server matches the same way, so the card shown is the style the interviewer uses. */
export function matchStyle(styles: readonly CompanyStyle[], company: string): CompanyStyle | null {
  const key = companyKey(company);
  if (!key) return null;
  const byKey = new Map<string, CompanyStyle>();
  for (const s of styles) for (const n of [s.name, s.slug.replace(/-/g, " "), ...s.aliases]) byKey.set(companyKey(n), s);
  const exact = byKey.get(key);
  if (exact) return exact;
  const words = key.split(" ");
  for (let n = words.length - 1; n > 0; n--) {
    const hit = byKey.get(words.slice(0, n).join(" "));
    if (hit) return hit;
  }
  return null;
}

/** A mock session for the company: a negotiation's recruiter works there; any other round asks in its style. */
export function withCompany(req: CreateSessionRequest, company: string): CreateSessionRequest {
  const name = company.trim().slice(0, 120);
  if (!name || !req.mock) return req;
  if (req.mock.negotiation) {
    return req.mock.negotiation.company?.trim() ? req : { ...req, mock: { ...req.mock, negotiation: { ...req.mock.negotiation, company: name } } };
  }
  return { ...req, mock: { ...req.mock, company: name } };
}
