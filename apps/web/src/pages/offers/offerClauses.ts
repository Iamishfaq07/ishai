/**
 * Offer letter check (career-ops' offer-prep step: walk the contract clauses and list questions before signing):
 * finds the clauses that most often surprise people — a service bond, non-compete, joining-bonus clawback, long
 * notice, conditional variable pay — quotes them, says what each usually means and what to ask HR. Pattern-based, in
 * the browser. Not legal advice; for a large bond or a strict non-compete, a lawyer's read is worth it.
 */

export type Weight = "check" | "ask";
export interface Clause { id: string; weight: Weight; label: string; means: string; ask: string; quote: string; amount?: string }

const RULES: { id: string; weight: Weight; label: string; re: RegExp; means: string; ask: string }[] = [
  { id: "bond", weight: "check", label: "Service bond or training cost recovery",
    re: /\b(?:service\s+(?:agreement|bond)|bond\s+(?:period|amount|of)|training\s+(?:cost|bond|recovery)|liquidated\s+damages|minimum\s+(?:service|tenure)\s+(?:period|of))\b/i,
    means: "You agree to stay a minimum time or repay an amount if you leave early.",
    ask: "How much would I repay, and does it reduce month by month? Is it waived if I'm let go?" },
  { id: "noncompete", weight: "check", label: "Non-compete or non-solicitation",
    re: /\b(?:non[-\s]?compet(?:e|ition)|not\s+(?:to\s+)?(?:join|work\s+for)\s+(?:a\s+|any\s+)?competitor|non[-\s]?solicit(?:ation)?)\b/i,
    means: "Limits where you can work, or whom you can approach, after you leave.",
    ask: "Which companies or roles does it cover, for how long, and in which places?" },
  { id: "clawback", weight: "check", label: "Joining bonus or relocation clawback",
    re: /\b(?:(?:joining|signing|sign-on)\s+bonus|relocation\s+(?:assistance|allowance|bonus))\b[^.]{0,200}\b(?:repay|refund|recover|return|claw)/i,
    means: "A bonus or relocation payment you'd pay back if you leave within a set time.",
    ask: "Is the repayment pro-rated, and over how many months?" },
  { id: "notice", weight: "ask", label: "Notice period",
    re: /\bnotice\s+period\b[^.]{0,80}?\b(\d{1,3})\s*(?:days?|months?|weeks?)|\b(\d{1,3})\s*(?:days?|months?)(?:'|’)?\s+(?:written\s+)?notice\b/i,
    means: "How long you must work after resigning (and often what the employer gives you).",
    ask: "Is it the same during probation, and can it be bought out or shortened?" },
  { id: "probation", weight: "ask", label: "Probation period",
    re: /\b(?:probation(?:ary)?\s+period|on\s+probation)\b/i,
    means: "A trial period with a shorter notice period and sometimes fewer benefits.",
    ask: "How long is probation, what's the notice during it, and how is confirmation decided?" },
  { id: "variable", weight: "ask", label: "Variable or performance pay",
    re: /\b(?:variable\s+(?:pay|component|compensation)|performance\s+(?:bonus|linked|incentive)|target\s+bonus|at[-\s]risk)\b/i,
    means: "Part of the pay depends on targets, so it may not be paid in full.",
    ask: "What share was actually paid out to people at my level last year, and when is it paid?" },
  { id: "conditional", weight: "ask", label: "Conditions before the offer is final",
    re: /\b(?:subject\s+to|contingent\s+(?:up)?on|conditional\s+(?:up)?on)\b[^.]{0,80}\b(?:background|verification|reference|medical|documents?|clearance)\b/i,
    means: "The offer depends on checks (background, references, documents) that come later.",
    ask: "What's checked, how long does it take, and should I resign before it's complete?" },
  { id: "ip", weight: "ask", label: "Intellectual property and side work",
    re: /\b(?:intellectual\s+property|inventions?\s+(?:assignment|made)|moonlight(?:ing)?|outside\s+(?:employment|work|business))\b/i,
    means: "What you create may belong to the employer, and side jobs may need approval.",
    ask: "Does it cover personal projects made in my own time, on my own equipment?" },
  { id: "transfer", weight: "ask", label: "Transfer or relocation at the employer's choice",
    re: /\b(?:liable\s+to\s+(?:be\s+)?transfer(?:red)?|transfer(?:red)?\s+to\s+any\s+(?:location|office|branch|city)|any\s+of\s+(?:its|the\s+company(?:'|’)s)\s+(?:offices|locations))\b/i,
    means: "You could be moved to another city or office.",
    ask: "How likely is a transfer for this role, and would relocation be paid?" },
  { id: "deadline", weight: "ask", label: "Deadline to accept",
    re: /\b(?:accept\s+(?:this\s+offer\s+)?(?:by|within|before)|offer\s+(?:is\s+)?valid\s+(?:till|until|for)|lapse|expire)s?\b[^.]{0,40}/i,
    means: "The offer lapses if you don't sign in time.",
    ask: "If I need a few more days to decide, is that possible?" },
];

const MONEY = /(?:₹|\brs\.?|\binr|\$|\busd|£|€)\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:lakhs?|lacs?|l\b|k\b))?|\b\d+(?:\.\d+)?\s*(?:lakhs?|lacs?)\b/i;

function quote(text: string, at: number, len: number): string {
  // Sentences end at a full stop before a capital or the end ("Rs. 2,00,000" doesn't end one).
  const stops = [...text.slice(0, at).matchAll(/\.(?=\s+[A-Z])/g)];
  const start = stops.length ? stops[stops.length - 1]!.index! + 1 : 0;
  const after = /\.(?=\s+[A-Z]|\s*$)/.exec(text.slice(at + len));
  const end = after ? Math.min(at + len + after.index + 1, at + len + 240) : Math.min(text.length, at + len + 160);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function checkOffer(text: string): Clause[] {
  const t = text.slice(0, 40000);
  const out: Clause[] = [];
  for (const r of RULES) {
    const m = r.re.exec(t);
    if (!m) continue;
    const q = quote(t, m.index, m[0].length);
    const amount = r.id === "bond" || r.id === "clawback" ? MONEY.exec(q)?.[0].trim() : undefined;
    out.push({ id: r.id, weight: r.weight, label: r.label, means: r.means, ask: r.ask, quote: q, ...(amount ? { amount } : {}) });
  }
  return out.sort((a, b) => (a.weight === b.weight ? 0 : a.weight === "check" ? -1 : 1));
}

/** The questions for HR, numbered, ready to paste into an email. */
export function questionsEmail(clauses: Clause[], company: string): string {
  if (!clauses.length) return "";
  return [
    `Hi${company.trim() ? ` ${company.trim()} team` : ""},`,
    "",
    "Thank you for the offer. Before I sign, could you help me with a few questions?",
    "",
    ...clauses.map((c, i) => `${i + 1}. ${c.label}: ${c.ask}`),
    "",
    "Thank you, and I look forward to hearing from you.",
  ].join("\n");
}
