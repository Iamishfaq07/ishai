// Matching a form's questions to the candidate's pre-approved answers, and picking options. Pure: no DOM.
// The rule throughout: exact or normalized-exact matches only. Anything else is "unknown", and the candidate answers it.
import type { AnswerValue, PacketAnswer } from "./contract";

/** Lower case, accents and punctuation dropped, required/optional markers removed, spaces collapsed. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\((optional|required)\)/g, " ")
    .replace(/[*✱]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A form label as shown, without the required marker and extra spaces. */
export function cleanLabel(text: string): string {
  return text.replace(/[*✱]/g, " ").replace(/\s+/g, " ").trim();
}

/** Greenhouse ids as Orbit's server reads them from the board API (`question_123`, `demographic_456`) and as the page
 * shows them (`question_123` or `123`, `456`): the same question either way. */
const stripPrefix = (id: string) => id.trim().replace(/^(question_|demographic_)/, "");

/**
 * The packet answer for a question: by the ATS's question id first, then the label exactly, then the normalized
 * label. Two answers that both match but disagree are ambiguous: no answer (never guess).
 */
export function matchAnswer(q: { questionId: string | null; label: string }, answers: PacketAnswer[]): PacketAnswer | null {
  if (q.questionId) {
    const id = stripPrefix(q.questionId);
    const byId = answers.filter((a) => a.question_id && stripPrefix(a.question_id) === id);
    if (byId.length) return unique(byId);
  }
  const label = q.label.trim();
  if (!label) return null;
  const exact = answers.filter((a) => a.label.trim() === label);
  if (exact.length) return unique(exact);
  const norm = normalize(label);
  if (!norm) return null;
  const close = answers.filter((a) => normalize(a.label) === norm);
  return close.length ? unique(close) : null;
}

/** A select-type answer the server read the form's options for must name them exactly (a stale answer doesn't). */
export function withinOptions(answer: PacketAnswer): boolean {
  const options = answer.options;
  if (!options?.length || !/^(select|multiselect|multi_select)$/.test(answer.kind)) return true;
  const values = Array.isArray(answer.value) ? answer.value : [answer.value];
  return values.every((v) => options.some((o) => o.trim() === v.trim()));
}

function unique(found: PacketAnswer[]): PacketAnswer | null {
  const first = JSON.stringify(found[0]!.value);
  return found.every((a) => JSON.stringify(a.value) === first) ? found[0]! : null;
}

const YES = new Set(["yes", "y", "true"]);
const NO = new Set(["no", "n", "false"]);

/** The index of the option an answer names: exact text, then normalized. Yes/no answers ("Yes"/"No", the server's
 * labels for a boolean) match "Yes"/"No" options. -1 if none (or more than one) matches. */
export function pickOption(options: string[], value: string): number {
  const want = value;
  const exact = options.map((o, i) => (o.trim() === want.trim() ? i : -1)).filter((i) => i >= 0);
  if (exact.length === 1) return exact[0]!;
  const norm = normalize(want);
  const close = options.map((o, i) => (normalize(o) === norm ? i : -1)).filter((i) => i >= 0);
  if (close.length === 1) return close[0]!;
  if (YES.has(norm) || NO.has(norm)) {
    const set = YES.has(norm) ? YES : NO.has(norm) ? NO : null;
    if (set) {
      const yn = options.map((o, i) => (set.has(normalize(o)) ? i : -1)).filter((i) => i >= 0);
      if (yn.length === 1) return yn[0]!;
    }
  }
  return -1;
}

/** Several options (checkbox group / multi-select): every one must match, else null. */
export function pickOptions(options: string[], values: string[]): number[] | null {
  const out: number[] = [];
  for (const v of values) {
    const i = pickOption(options, v);
    if (i < 0) return null;
    out.push(i);
  }
  return out;
}

const EEO = /\b(gender|sex|race|racial|ethnic\w*|hispanic|latin[oax]|veteran|disabilit\w*|disabled|lgbt\w*|sexual orientation|transgender|self[- ]identif\w*|demographic\w*|eeoc?)\b/;

/** A voluntary equal-opportunity / diversity question (gender, race, veteran, disability…). */
export function isEeo(label: string, context = ""): boolean {
  return EEO.test(normalize(label)) || /\b(eeoc?|voluntary self identification|equal (employment )?opportunity)\b/.test(normalize(context));
}

const DECLINE = /\b(decline|prefer not|rather not|choose not|do not wish|don ?t wish|not wish|do not want|don ?t want|not to (say|disclose|answer|self identify|specify)|no answer|wish not)\b/;

/** The "decline to self-identify" option, if the question has one. */
export function declineOption(options: string[]): number {
  return options.findIndex((o) => DECLINE.test(normalize(o)));
}

const CONSENT = /\b(consent\w*|agree\w*|acknowledg\w*|certif\w*|attest\w*|privacy|terms|gdpr|accept\w*|i confirm|i understand|data (processing|protection|retention))\b/;

/** A consent / privacy / attestation question: only answered from an explicit packet answer. */
export function isConsent(label: string): boolean {
  return CONSENT.test(normalize(label));
}

/** Truthy yes/no from an answer value, or null when the value isn't a yes/no. */
export function asBoolean(value: AnswerValue): boolean | null {
  if (Array.isArray(value)) return null;
  const n = normalize(value);
  if (YES.has(n) || /^(i )?(agree|accept|consent)/.test(n)) return true;
  if (NO.has(n)) return false;
  return null;
}
