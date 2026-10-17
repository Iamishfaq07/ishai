// The question bank's pages (BankPages.tsx): addresses, group names, search and the links into Practice and the
// warm-up. Plain functions over the bank's cards and files, shared with the build-time prerender (src/prerender).
import type { AnswerKind, BankCard, BankCompany, BankQuestion, BankRole, CompanyGroup, QuestionType, RoleGroup } from "./types";

export type BankKind = "company" | "role";

export const COMPANIES_PATH = "/companies";
export const ROLES_PATH = "/roles";

export const companyPath = (slug: string): string => `${COMPANIES_PATH}/${slug}`;
export const rolePath = (slug: string): string => `${ROLES_PATH}/${slug}`;
export const entryPath = (kind: BankKind, slug: string): string => (kind === "company" ? companyPath(slug) : rolePath(slug));

/** The list pages' sections, in the order shown. */
export const COMPANY_GROUPS: Array<[CompanyGroup, string]> = [
  ["it-services", "IT services and outsourcing"],
  ["india-product", "Indian product companies"],
  ["global-tech", "Global technology companies"],
  ["consulting", "Consulting and the Big Four"],
  ["finance", "Banks, payments and finance"],
  ["industry", "Industry, consumer and public sector"],
];

export const ROLE_GROUPS: Array<[RoleGroup, string]> = [
  ["early-career", "Campus and early career"],
  ["engineering", "Software engineering"],
  ["data", "Data and AI"],
  ["product-design", "Product, design and delivery"],
  ["business", "Business, sales and support"],
  ["core-engineering", "Core engineering"],
  ["public-service", "Teaching and healthcare"],
];

/** A guide's question sections, in the order shown, with the heading for a company or a role. */
export function questionSections(kind: BankKind, name: string): Array<[QuestionType, string]> {
  return kind === "company"
    ? [
        ["behavioral", "Behavioral questions"],
        ["role", "Role and technical questions"],
        ["fit", `Why ${name}? Fit and HR questions`],
      ]
    : [
        ["behavioral", "Behavioral questions"],
        ["role", "Questions about the job"],
        ["fit", "Motivation and fit"],
      ];
}

/** "Tata Consultancy Services Ltd." → "tata consultancy services" (as the server matches names). */
export function searchKey(text: string): string {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");
}

/** The cards matching what's typed, in their list order: every word typed starts a word of the name or an alias,
 *  or the whole query appears in one ("cons" finds Consulting, "tcs" finds TCS, "big four" finds Deloitte…). */
export function searchCards<T extends BankCard>(cards: readonly T[], query: string): T[] {
  const q = searchKey(query);
  if (!q) return [...cards];
  const words = q.split(" ");
  return cards.filter((c) => {
    const names = [c.name, c.slug.replace(/-/g, " "), ...c.aliases].map(searchKey);
    const hay = names.join(" | ");
    if (hay.includes(q)) return true;
    const tokens = hay.split(/[ |]+/);
    return words.every((w) => tokens.some((t) => t.startsWith(w)));
  });
}

/** The cards in a group, in file order. */
export function inGroup<T extends BankCard>(cards: readonly T[], group: string): T[] {
  return cards.filter((c) => c.group === group);
}

/** Up to `n` other guides in the same group, starting after this one (so every guide links on to different ones). */
export function related<T extends BankCard>(cards: readonly T[], slug: string, n = 6): T[] {
  const self = cards.find((c) => c.slug === slug);
  if (!self) return [];
  const group = inGroup(cards, self.group);
  const at = group.findIndex((c) => c.slug === slug);
  return [...group.slice(at + 1), ...group.slice(0, at)].slice(0, n);
}

/** The first sentence of a summary, for a card. */
export function firstSentence(text: string, max = 160): string {
  const end = text.search(/[.!?](\s|$)/);
  const s = end > 0 ? text.slice(0, end + 1) : text;
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** Practice, set to interview the way this company does (the Company field; Mock.tsx reads `?company=`). */
export function companyMockLink(company: Pick<BankCompany, "name">): string {
  return `/mock?${new URLSearchParams({ company: company.name })}`;
}

/** Practice with the role filled in and its round chosen under "Customise" (Mock.tsx reads `?role=`, `?type=`,
 *  `?persona=` and `?customise`). */
export function roleMockLink(role: Pick<BankRole, "name" | "mock">): string {
  return `/mock?${new URLSearchParams({ role: role.name, type: role.mock.interview_type, persona: role.mock.persona, customise: "1" })}`;
}

/** The free warm-up on this guide's questions (no account, no AI): `?track=company:<slug>` or `role:<slug>`. */
export function warmupLink(kind: BankKind, slug: string): string {
  return `/warmup?${new URLSearchParams({ track: `${kind}:${slug}` })}`;
}

export function parseTrack(track: string | null | undefined): { kind: BankKind; slug: string } | null {
  const m = /^(company|role):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(track ?? "");
  return m ? { kind: m[1] as BankKind, slug: m[2]! } : null;
}

export interface WarmupItem {
  id: string;
  text: string;
  kind: AnswerKind;
  tip: string;
}

/** A guide's questions as warm-up questions: what a good answer covers becomes the tip under each. */
export function warmupItems(slug: string, questions: readonly BankQuestion[]): WarmupItem[] {
  return questions.map((q, i) => ({ id: `${slug}-${i + 1}`, text: q.text, kind: q.kind, tip: `Cover: ${q.covers.join("; ")}.` }));
}

/** "2026-10-18" → "18 October 2026" (fixed, so the built page and the app say the same). */
export function reviewedOn(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return y && m && d ? `${d} ${months[m - 1]} ${y}` : iso;
}
