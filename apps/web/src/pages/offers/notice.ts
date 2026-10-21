/**
 * Resigning well: the last working day from the resignation date and notice period, whether it clashes with the new
 * joining date, a plain resignation letter, and the exit checklist. Arithmetic and templates only; the candidate's
 * contract decides the real notice terms.
 */

export interface NoticeInput { resignOn: string; amount: number; unit: "days" | "months"; joinOn: string }

const DAY = 86_400_000;
const parse = (d: string) => { const t = Date.parse(`${d}T00:00:00`); return Number.isNaN(t) ? null : new Date(t); };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Notice served from the resignation date: the last working day is the day before the period ends. */
export function lastDay(n: NoticeInput): string | null {
  const start = parse(n.resignOn);
  if (!start || !(n.amount > 0)) return null;
  const end = new Date(start);
  if (n.unit === "days") end.setDate(end.getDate() + n.amount - 1);
  else {
    const day = end.getDate();
    end.setDate(1); end.setMonth(end.getMonth() + n.amount);
    end.setDate(Math.min(day, new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()) - 1);
  }
  return iso(end);
}

/** Days between the last working day and joining: negative means joining comes first (an early release is needed). */
export function gapDays(last: string | null, joinOn: string): number | null {
  const a = last ? parse(last) : null, b = parse(joinOn);
  return a && b ? Math.round((b.getTime() - a.getTime()) / DAY) - 1 : null;
}

export function letter(o: { manager: string; role: string; company: string; last: string | null; name: string }): string {
  const when = o.last ? new Date(`${o.last}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "[last working day]";
  return [
    `Dear ${o.manager.trim() || "[manager's name]"},`,
    "",
    `Please accept this as formal notice of my resignation from my position as ${o.role.trim() || "[your role]"} at ${o.company.trim() || "[company]"}. As per my notice period, my last working day will be ${when}.`,
    "",
    "Thank you for the opportunities and support during my time here. I'll make sure my work is handed over properly, and I'm happy to help train whoever takes it on.",
    "",
    "Please let me know the next steps for the handover and exit formalities.",
    "",
    "Best regards,",
    o.name.trim() || "[your name]",
  ].join("\n");
}

export function exitChecklist(india: boolean): string[] {
  return [
    "Sign the new offer in writing before you resign",
    "Tell your manager in person or on a call first, then send the letter",
    "Write a handover document: open work, contacts, passwords handed over properly",
    "Return the laptop, ID card and other company property",
    ...(india ? [
      "Ask for your relieving letter and experience letter",
      "Check your full and final settlement: leave encashment, bonus, deductions",
      "Transfer your PF to the new employer using your UAN",
      "Collect Form 16 for the year, for your tax return",
    ] : [
      "Confirm your final pay, unused leave and benefits end date",
      "Ask for a reference or a written confirmation of employment",
    ]),
    "Save personal files and contacts (never company data)",
    "Update LinkedIn after your last day, not before",
  ];
}
