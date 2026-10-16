import type { CreateSessionRequest, JobOfferRecord, OfferInput } from "@orbit/types";
import { INDIA, isIndia } from "@orbit/ui";

export const OFFERS_HOME = "/offers";
export const offerPath = (id: string) => `${OFFERS_HOME}/${encodeURIComponent(id)}`;

/**
 * What an offer's parts are called where the user applies: India's fixed pay, variable and joining bonus, or the base
 * salary, target bonus and signing bonus offers use elsewhere (the words the AI plan uses there too).
 */
export interface OfferTerms {
  fixed: string;
  fixedShort: string;
  fixedWord: string;
  variableForm: string;
  variableRow: string;
  variableYear: string;
  variableWord: string;
  /** The variable part on its own ("Variable, as paid out" / "Bonus, as paid out"), and as pay. */
  bonusWord: string;
  bonusPay: string;
  joining: string;
  joiningWord: string;
}

const INDIA_TERMS: OfferTerms = {
  fixed: "Fixed pay", fixedShort: "Fixed", fixedWord: "fixed",
  variableForm: "Variable / bonus a year", variableRow: "Variable (target)", variableYear: "Variable a year (target)",
  variableWord: "variable", bonusWord: "variable", bonusPay: "the variable pay",
  joining: "Joining bonus", joiningWord: "joining bonus",
};
const WORLD_TERMS: OfferTerms = {
  fixed: "Base salary", fixedShort: "Base", fixedWord: "base",
  variableForm: "Target bonus a year", variableRow: "Target bonus", variableYear: "Target bonus a year",
  variableWord: "target bonus", bonusWord: "bonus", bonusPay: "the bonus",
  joining: "Signing bonus", joiningWord: "signing bonus",
};

export function offerTerms(country: string = INDIA): OfferTerms {
  return isIndia(country) ? INDIA_TERMS : WORLD_TERMS;
}

/** "Variable" from "variable": a word starting a label. */
export function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const SIGN: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

/** "₹24L", "₹1.2Cr", "₹85,000" (a month), "$165k": short, for the cards and the table. */
export function money(currency: string, value: number, exact = false): string {
  const sign = SIGN[currency] ?? `${currency} `;
  const v = Math.round(value);
  if (currency === "INR") {
    if (!exact && Math.abs(v) >= 10_000_000) return `${sign}${trim(v / 10_000_000)}Cr`;
    if (!exact && Math.abs(v) >= 100_000) return `${sign}${trim(v / 100_000)}L`;
    return `${sign}${v.toLocaleString("en-IN")}`;
  }
  if (!exact && Math.abs(v) >= 1_000) return `${sign}${trim(v / 1_000)}k`;
  return `${sign}${v.toLocaleString("en-US")}`;
}

function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** "24" with unit "L" read back to a number: the form takes lakhs (India) or thousands, as offers are written. */
export function unitFor(currency: string): { label: string; factor: number } {
  return currency === "INR" ? { label: "lakh a year", factor: 100_000 } : { label: "thousand a year", factor: 1_000 };
}

export function emptyOffer(currency: string): OfferInput {
  return {
    company: "", role: "", city: "", currency, fixed: 0, variable: 0, joining_bonus: 0, equity_per_year: 0, other: 0,
    pf: "capped", employer_costs_in_ctc: true, deadline: null, status: "considering", notes: "",
  };
}

export function inputOf(o: JobOfferRecord): OfferInput {
  const { company, role, city, currency, fixed, variable, joining_bonus, equity_per_year, other, pf, employer_costs_in_ctc, deadline, status, notes } = o;
  return { company, role, city, currency, fixed, variable, joining_bonus, equity_per_year, other, pf, employer_costs_in_ctc, deadline, status, notes };
}

/** The offer as the AI recruiter presents it on the practice call: "₹24L fixed + ₹2.4L variable + ₹2L joining bonus"
 *  ("$150k base + $15k target bonus + $10k signing bonus" outside India). */
export function offerLine(o: OfferInput, country: string = INDIA): string {
  const t = offerTerms(country);
  const parts = [`${money(o.currency, o.fixed)} ${t.fixedWord}`];
  if (o.variable) parts.push(`${money(o.currency, o.variable)} ${t.variableWord}`);
  if (o.joining_bonus) parts.push(`${money(o.currency, o.joining_bonus)} ${t.joiningWord}`);
  if (o.equity_per_year) parts.push(`${money(o.currency, o.equity_per_year)} a year in equity`);
  if (o.other) parts.push(`${money(o.currency, o.other)} other`);
  return `${parts.join(" + ")} a year`.replace(` ${t.joiningWord} a year`, ` ${t.joiningWord}`);
}

/** Practice's salary negotiation, set up for this offer: the recruiter works at the company and makes this offer;
 *  the target (the plan's ask, when there is one) only the review sees. */
export function practiceRequest(o: JobOfferRecord, country: string = INDIA): CreateSessionRequest {
  return {
    title: `Negotiation — ${o.company}`.slice(0, 200),
    type: "mock",
    role: o.role,
    language: "en",
    length: "standard",
    style: "natural",
    auto_answer: false,
    document_ids: [],
    mock: {
      interview_type: "negotiation",
      difficulty: "medium",
      duration_minutes: 10,
      persona: "recruiter",
      negotiation: {
        offer: offerLine(o, country),
        company: o.company.slice(0, 120),
        ...(o.plan ? { target: `${money(o.currency, o.plan.ask)} ${offerTerms(country).fixedWord}` } : {}),
      },
    },
  };
}

/** Where the fixed pay sits in the market's range, 0-100, for the range bar (clamped to the bar's ends). */
export function placeOnRange(value: number, low: number, high: number): number {
  if (high <= low) return 50;
  return Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
}

/** The side-by-side rows: each offer's figure, and which offer is best on it (higher pays more). */
export type CompareRow = { label: string; values: Array<number | null>; best: number | null };

export function compareRows(offers: JobOfferRecord[], country: string = INDIA): CompareRow[] {
  const t = offerTerms(country);
  const row = (label: string, pick: (o: JobOfferRecord) => number | null): CompareRow => {
    const values = offers.map(pick);
    const nums = values.filter((v): v is number => v !== null);
    const top = nums.length > 1 ? Math.max(...nums) : null;
    const best = top !== null && nums.filter((v) => v === top).length === 1 ? values.indexOf(top) : null;
    return { label, values, best };
  };
  const rows = [
    row(t.fixed, (o) => o.fixed),
    row(t.variableRow, (o) => o.variable),
    row(t.joining, (o) => o.joining_bonus),
    row("Equity a year", (o) => o.equity_per_year),
    row("First year, all in", (o) => o.first_year),
    row("Every year after", (o) => o.yearly),
  ];
  if (offers.some((o) => o.take_home)) rows.push(row("In the bank each month", (o) => o.take_home?.monthly ?? null));
  return rows.filter((r) => r.values.some((v) => v));
}
