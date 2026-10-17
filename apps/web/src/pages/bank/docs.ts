// One guide's whole file, fetched on demand (each JSON is its own chunk), once per page load. The promise is kept, so
// React's `use()` sees the same one on every render; an unknown slug resolves to null (the page shows "not found").
import { companyDocs, roleDocs } from "virtual:question-bank/docs";
import type { BankCompany, BankRole } from "./types";

const companies = new Map<string, Promise<BankCompany | null>>();
const roles = new Map<string, Promise<BankRole | null>>();

function load<T>(cache: Map<string, Promise<T | null>>, docs: Record<string, () => Promise<{ default: T }>>, slug: string) {
  let p = cache.get(slug);
  if (!p) {
    const loader = Object.prototype.hasOwnProperty.call(docs, slug) ? docs[slug] : undefined;
    p = loader ? loader().then((m) => m.default) : Promise.resolve(null);
    cache.set(slug, p);
  }
  return p;
}

export const loadCompany = (slug: string): Promise<BankCompany | null> => load(companies, companyDocs, slug);
export const loadRole = (slug: string): Promise<BankRole | null> => load(roles, roleDocs, slug);
export const companySlugs = (): string[] => Object.keys(companyDocs);
export const roleSlugs = (): string[] => Object.keys(roleDocs);
