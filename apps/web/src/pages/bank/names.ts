// The guides' names by address, for the tab title ("Amazon interview guide · Orbit"): names only, so the main bundle
// stays small (the cards and the guides load with their pages).
import { companyNames, roleNames } from "virtual:question-bank/names";

/** "Amazon interview guide" for /companies/amazon, "Data analyst interview guide" for /roles/data-analyst. */
export function guideTitle(pathname: string): string | null {
  const m = /^\/(companies|roles)\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (!m) return null;
  const names = m[1] === "companies" ? companyNames : roleNames;
  const name = Object.prototype.hasOwnProperty.call(names, m[2]!) ? names[m[2]!] : undefined;
  return name ? `${name} interview guide` : null;
}
