// The written English round: a formal email written to a brief, or a short essay, against the clock. Entry-level
// online tests (campus drives, service companies) include one; the exact format and word count vary by employer,
// so these are practice briefs in that style, not any company's real questions. The checks here are instant and
// rule-based; the AI review (POST /v1/practice/written-review) judges content, language and tone.
import { words } from "../../lib/warmup/checks";

export type Kind = "email" | "essay";

export interface Brief { id: string; kind: Kind; title: string; text: string; points: string[]; minutes: number; range: [number, number] }

export const BRIEFS: Brief[] = [
  { id: "wifi", kind: "email", title: "Hostel Wi-Fi not working", minutes: 10, range: [100, 150],
    text: "You are a student staying in the college hostel. The Wi-Fi in your block has not worked for four days and you have an online exam next week. Write an email to the hostel warden explaining the problem, how it affects you, and asking when it will be fixed.",
    points: ["the problem and since when", "how it affects you (the exam)", "ask when it will be fixed"] },
  { id: "leave", kind: "email", title: "Leave request to your manager", minutes: 10, range: [90, 140],
    text: "You work as a trainee software engineer. Your sister's wedding is in three weeks and you need four days of leave. Write an email to your manager requesting leave, giving the dates, and explaining how your work will be handled while you are away.",
    points: ["request leave", "the dates", "who handles your work"] },
  { id: "delivery", kind: "email", title: "Late delivery complaint", minutes: 10, range: [100, 150],
    text: "You ordered a laptop online for your new job. It was promised in three days but has not arrived after ten days, and the customer care number does not answer. Write an email to the company's support team describing the issue, giving your order number, and asking for a refund or a confirmed delivery date.",
    points: ["the order and the delay", "the order number", "refund or a delivery date"] },
  { id: "welcome", kind: "email", title: "Welcome a new team member", minutes: 8, range: [80, 130],
    text: "A new colleague, Meera, joins your team on Monday. Your manager asks you to write an email welcoming her, telling her the time and place of the first-day meeting, and what she should bring.",
    points: ["welcome Meera", "time and place of the meeting", "what to bring"] },
  { id: "reschedule", kind: "email", title: "Reschedule an interview", minutes: 8, range: [80, 130],
    text: "You have an interview on Thursday at 11 am, but your university has just scheduled your final practical exam at the same time. Write to the recruiter apologising, explaining the clash, and offering two other times that suit you.",
    points: ["apologise", "explain the clash", "offer two other times"] },
  { id: "ai-jobs", kind: "essay", title: "AI and jobs", minutes: 20, range: [200, 300],
    text: "\"Artificial intelligence will create more jobs than it takes away.\" Do you agree or disagree? Give reasons and examples.",
    points: ["a clear position", "two reasons with examples", "the other side, briefly", "a conclusion"] },
  { id: "wfh", kind: "essay", title: "Work from home", minutes: 20, range: [200, 300],
    text: "Should companies let employees work from home permanently? Discuss the advantages and disadvantages, and give your own view.",
    points: ["advantages", "disadvantages", "your view", "a conclusion"] },
  { id: "attendance", kind: "essay", title: "Compulsory attendance", minutes: 20, range: [200, 300],
    text: "Should attendance in college lectures be compulsory? Give reasons for your answer.",
    points: ["a clear position", "reasons with examples", "the other side, briefly", "a conclusion"] },
  { id: "social", kind: "essay", title: "Social media and young people", minutes: 20, range: [200, 300],
    text: "Has social media done more good than harm to young people? Support your view with examples.",
    points: ["a clear position", "examples", "the other side, briefly", "a conclusion"] },
];

export interface Check { label: string; ok: boolean; detail: string }

const SMS = /\b(u|ur|pls|plz|thx|tnx|gonna|wanna|asap|bcoz|coz|cos|ok+y?|hii+|tmrw|dnt|cant|wont|im)\b/i;

/** Instant, rule-based checks of the form. They don't judge content or grammar: the AI review does. */
export function checkWritten(brief: Brief, subject: string, text: string): Check[] {
  const n = words(text).length;
  const [min, max] = brief.range;
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const checks: Check[] = [
    { label: "Length", ok: n >= min && n <= max + 30,
      detail: n < min ? `${n} words: aim for ${min} to ${max}.` : n > max + 30 ? `${n} words: trim to about ${max}.` : `${n} words, within ${min} to ${max}.` },
    { label: "Paragraphs", ok: paragraphs.length >= (brief.kind === "essay" ? 3 : 2),
      detail: brief.kind === "essay" ? "An introduction, body paragraphs and a conclusion, with a blank line between them."
        : "A short opening, the details, and a closing request, each its own paragraph." },
  ];
  if (brief.kind === "email") {
    checks.unshift({ label: "Subject line", ok: subject.trim().length >= 6 && words(subject).length <= 12,
      detail: subject.trim() ? "Short and specific is best, e.g. \"Leave request: 12 to 15 March\"." : "Add a subject: say what the email is about in a few words." });
    checks.push(
      { label: "Greeting", ok: /^(dear|hello|hi|good (morning|afternoon|evening)|respected)\b/i.test(lines[0] ?? ""),
        detail: "Open with \"Dear Mr Sharma,\" or \"Dear Sir or Madam,\"." },
      { label: "Sign-off", ok: /\b(regards|sincerely|yours (faithfully|sincerely|truly)|thank you|thanks|best)\b/i.test(lines.slice(-3).join(" ")),
        detail: "Close with \"Regards,\" or \"Yours sincerely,\" and your name." },
    );
  }
  const sms = text.match(SMS);
  checks.push({ label: "No text-speak", ok: !sms, detail: sms ? `"${sms[0]}" reads as chat. Spell words out.` : "No chat spellings found." });
  const lowerI = /(^|[\s.,!?])i(?=[\s',])/.test(text);
  checks.push({ label: "Capital I", ok: !lowerI, detail: lowerI ? "Write \"I\" as a capital letter." : "\"I\" is capitalised." });
  return checks;
}

export function timeLeft(startedAt: number, minutes: number, now: number): number {
  return Math.max(0, Math.round(minutes * 60 - (now - startedAt) / 1000));
}
