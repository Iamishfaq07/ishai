/**
 * What to say when a recruiter asks about pay, before there's an offer: the scripts negotiation guides and
 * open-source interview coaches give for the screen call (defer politely, then a researched range; current pay
 * stated plainly where it's routinely asked, as in India; notice period; time to decide). Templates over the
 * candidate's own numbers; no figure is ever suggested by Orbit.
 */

export interface ScriptInput {
  low: string; high: string; current: string; notice: string; role: string; city: string; india: boolean;
}

export function scripts(s: ScriptInput): { q: string; when: string; say: string }[] {
  const range = s.low && s.high ? `${s.low} to ${s.high}` : s.low || s.high || "[your researched range]";
  const forRole = [s.role && `a ${s.role} role`, s.city && `in ${s.city}`].filter(Boolean).join(" ") || "this role and level";
  const out = [
    { q: "“What are your salary expectations?” (early in the process)", when: "First ask: learn their budget before naming a number.",
      say: "I'd like to understand the role and the full package first, so I can give you a fair number. Could you share the budgeted range for this position?" },
    { q: "“What are your salary expectations?” (they insist)", when: "Give a researched range. Make the bottom of it a number you'd happily accept.",
      say: `Based on my research for ${forRole}, I'm looking at ${range}${s.india ? " CTC" : ""}, depending on the full package and the responsibilities.` },
    s.india
      ? { q: "“What is your current CTC?”", when: "Routinely asked in India. Be accurate: it's often checked against payslips.",
          say: `My current CTC is ${s.current || "[your current CTC]"}. My expectation is based on this role's scope and the market for it, rather than a fixed hike on my current pay.` }
      : { q: "“What do you earn now?”", when: "Some places don't allow employers to ask about pay history. You can steer to the role.",
          say: "I'd rather focus on the value I'd bring to this role. Based on my research, the range I mentioned reflects that." },
    { q: "“What is your notice period?”", when: "Say it plainly, and what you can do about it.",
      say: `My notice period is ${s.notice || "[notice period]"}. I'll ask my current employer about an early release once I have an offer in writing.` },
    { q: "“Can you accept today?” (offer on the call)", when: "Thank them, then ask for it in writing and a day or two.",
      say: "Thank you, I'm really pleased. Could you send the full offer in writing? I'd like a day or two to review it properly, and I'll come back to you by [date]." },
  ];
  return out;
}
