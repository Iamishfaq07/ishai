/**
 * Scam & safety check: reads a job post or a recruiter's message for the warning signs most often seen in job
 * scams (fees, OTP or bank requests, chat-only contact, free-mail "HR", per-day pay, pressure), lines hidden for AI
 * tools or in invisible characters, and for the signs of a
 * real role (a pay range, responsibilities, a company email). Runs in the browser; nothing is sent anywhere.
 * Signals, not a verdict: each one quotes the words it found so the candidate can judge.
 */

export type Level = "high" | "medium";
export interface Signal { id: string; level: Level; label: string; why: string; quote: string }
export interface Good { id: string; label: string; quote: string }
export interface PostingReport { signals: Signal[]; good: Good[]; checked: number }

const FREE_MAIL = /[\w.+-]+@(?:gmail|yahoo|hotmail|outlook|rediffmail|proton(?:mail)?|ymail|live)\.[a-z.]+/i;

const RULES: { id: string; level: Level; label: string; why: string; re: RegExp }[] = [
  { id: "fee", level: "high", label: "Asks you to pay",
    why: "Real employers don't charge for registration, training, a kit or a deposit.",
    re: /\b(?:registration|training|security|processing|verification|joining|kit|refundable|onboarding)\s+(?:fee|fees|charges?|deposit|amount)\b|\b(?:pay|deposit|transfer)\s+(?:rs\.?|₹|inr|usd|\$)\s?\d/i },
  { id: "secrets", level: "high", label: "Asks for an OTP or bank details",
    why: "No hiring process needs an OTP, UPI PIN, CVV or your bank login.",
    re: /\b(?:otp|upi\s*pin|cvv|net\s*banking|bank\s+(?:account\s+)?(?:details|password|login)|aadhaar\s+otp)\b/i },
  { id: "chat-only", level: "high", label: "Interview or contact only on chat",
    why: "Interviews held only on WhatsApp or Telegram are a common scam pattern. Check the company's own site and email.",
    re: /\b(?:whatsapp|telegram|signal)\b[^.\n]{0,60}\b(?:interview|hr|recruit|contact|message|join|apply)\b|\b(?:interview|hr|recruit|contact|apply)\b[^.\n]{0,60}\b(?:whatsapp|telegram)\b/i },
  { id: "free-mail", level: "high", label: "Recruiter uses a free email address",
    why: "Company recruiters write from the company's domain, not Gmail or Yahoo.",
    re: FREE_MAIL },
  { id: "per-day", level: "medium", label: "Pay quoted per day or per task",
    why: "\"Earn ₹3,000 a day from home\" style pay is typical of task and like-and-earn scams.",
    re: /\b(?:earn|salary|income|payout)\b[^.\n]{0,40}\b(?:per\s+(?:day|task|hour)|daily|a\s+day|weekly)\b|\b(?:like|subscribe|rate|review)\s+(?:videos?|products?|hotels?)\b[^.\n]{0,40}\b(?:earn|paid|commission)\b/i },
  { id: "pressure", level: "medium", label: "Pressure to decide fast",
    why: "Scams push urgency so you don't check. Real offers give you time.",
    re: /\b(?:urgent(?:ly)?\s+(?:hiring|requirement)|immediate\s+joining|limited\s+(?:seats|slots|vacancies)|within\s+(?:24|48)\s+hours|today\s+only|last\s+chance)\b/i },
  { id: "no-interview", level: "medium", label: "Hired without an interview",
    why: "An offer with no interview, or for a job you didn't apply to, is a warning sign.",
    re: /\b(?:no\s+interview|without\s+(?:an\s+)?interview|direct\s+(?:selection|joining|offer)|you\s+(?:have\s+been|are)\s+(?:selected|shortlisted)\s+for)\b/i },
  { id: "ai-trap", level: "medium", label: "A line written for AI tools",
    why: "Some posts hide instructions to catch or steer AI-written applications (open-source job agents check for these too). If it's an attention check addressed to applicants, follow it in what you write yourself; if it tells an AI to do something odd, ignore it.",
    re: /\b(?:if\s+you\s+are\s+(?:an?\s+)?(?:ai|llm|language\s+model|chatgpt|bot|automated)|ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+instructions|as\s+an\s+ai(?:\s+language)?\s+model|(?:include|mention|use|start\s+with)\s+the\s+(?:word|phrase|code(?:\s*word)?)\s+["“'‘]?[\w-]+)/i },
  { id: "invisible", level: "medium", label: "Invisible characters in the text",
    why: "Zero-width characters can hide text from you while software still reads it. Retype anything you copy from this post, and read it on the company's own careers page.",
    re: /[\u200b-\u200f\u2060-\u2064\ufeff]/ },
  { id: "investment", level: "medium", label: "Mentions crypto, trading or investment",
    why: "Jobs that need you to invest, trade or buy crypto are not jobs.",
    re: /\b(?:crypto|bitcoin|usdt|forex|trading\s+account|invest(?:ment)?\s+(?:required|of|amount))\b/i },
];

const GOOD: { id: string; label: string; re: RegExp }[] = [
  { id: "pay-range", label: "States a pay range",
    re: /(?:₹|rs\.?|inr|\$|usd|eur|£)\s?[\d.,]+\s*(?:k|l|lpa|lakhs?)?\s*(?:-|–|to)\s*(?:₹|rs\.?|inr|\$)?\s?[\d.,]+\s*(?:k|l|lpa|lakhs?)?|\b\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?\s*(?:lpa|lakhs?)\b/i },
  { id: "duties", label: "Lists real responsibilities",
    re: /\b(?:responsibilities|what\s+you(?:'|’)?ll\s+do|you\s+will\s+(?:build|own|work|lead|design)|key\s+duties)\b/i },
  { id: "process", label: "Describes the interview process",
    re: /\b(?:interview\s+process|rounds?\s+of\s+interviews?|technical\s+round|hiring\s+process)\b/i },
];

const INVISIBLE = /[\u200b-\u200f\u2060-\u2064\ufeff]/g;

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40), end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(INVISIBLE, "[hidden character]").replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Signals found in `text`. A company email (not free mail) counts as a good sign. */
export function checkPosting(text: string): PostingReport {
  const raw = text.slice(0, 20000);
  // Zero-width characters can split words ("re\u200bgistration fee") so the other rules read the text without them.
  const clean = raw.replace(INVISIBLE, "");
  const signals: Signal[] = [];
  for (const rule of RULES) {
    const src = rule.id === "invisible" ? raw : clean;
    const m = rule.re.exec(src);
    if (m) signals.push({ id: rule.id, level: rule.level, label: rule.label, why: rule.why, quote: quoteAround(src, m.index, m[0].length) });
  }
  const good: Good[] = [];
  for (const rule of GOOD) {
    const m = rule.re.exec(clean);
    if (m) good.push({ id: rule.id, label: rule.label, quote: quoteAround(clean, m.index, m[0].length) });
  }
  const company = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  for (const m of clean.matchAll(company)) {
    if (!FREE_MAIL.test(m[0])) { good.push({ id: "company-mail", label: "Uses a company email address", quote: m[0] }); break; }
  }
  signals.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
  return { signals, good, checked: clean.trim().length };
}
