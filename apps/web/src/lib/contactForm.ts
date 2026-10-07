import type { ContactContext, ContactRequest, ContactTopic } from "@orbit/types";
import { ApiError } from "@orbit/ui";
import { CONTACT_PAGE } from "./contact";

/**
 * The Contact page's small decisions, kept free of React so they're unit-tested (contactForm.test.ts): the topics,
 * what a link may prefill (`?topic=`, `?listing=`, `?reason=`, `?from=`), the checks before sending (the same bounds
 * the server holds), the request, and the error a person reads.
 */

export const NAME_MAX = 120;
export const PHONE_MAX = 32;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 3000;

/** The topics, in the server's order (contact/routes.py TOPICS), each with a line on what helps us answer. */
export const CONTACT_TOPICS: ReadonlyArray<{ id: ContactTopic; label: string; hint: string }> = [
  { id: "general", label: "General question", hint: "Ask anything about Orbit." },
  { id: "payment", label: "Payment or credits", hint: "Add the UTR (the 12-digit number in your UPI app), the amount and the date." },
  { id: "technical", label: "Technical problem", hint: "Say what you were doing, what happened, and on which device and browser." },
  { id: "report_job", label: "Report a job", hint: "Tell us what was wrong with the job. Never pay a fee or share an OTP for a job." },
  { id: "business", label: "Business or partnership", hint: "Colleges, placement cells and companies: tell us what you have in mind." },
  { id: "feedback", label: "Feedback", hint: "What works, what doesn't, what you'd like next." },
  { id: "other", label: "Other", hint: "Anything else." },
];

export function topicLabel(id: string): string {
  return CONTACT_TOPICS.find((t) => t.id === id)?.label ?? id;
}

function isTopic(value: string | null): value is ContactTopic {
  return CONTACT_TOPICS.some((t) => t.id === value);
}

/** An app path ("/jobs/listing/j1"), never another site ("//evil.example" or "https://..."). */
function appPath(value: string | null): string | null {
  const v = (value ?? "").trim();
  return v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") && v.length <= 200 ? v : null;
}

export interface ContactPrefill {
  topic: ContactTopic | null;
  /** A Jobs AI listing id: the reported job. */
  listing: string | null;
  /** What's wrong with it ("Asked me to pay a fee"). */
  reason: string | null;
  /** The page the form was opened from. */
  from: string | null;
}

/** What the address asks the form to start with. Anything unexpected is ignored, never shown as an error. */
export function readPrefill(search: string): ContactPrefill {
  const p = new URLSearchParams(search);
  const topic = p.get("topic");
  const listing = (p.get("listing") ?? "").trim();
  const reason = (p.get("reason") ?? "").replace(/\s+/g, " ").trim();
  return {
    topic: isTopic(topic) ? topic : listing ? "report_job" : null,
    listing: /^[A-Za-z0-9_:-]{1,64}$/.test(listing) ? listing : null,
    reason: reason && reason.length <= 80 ? reason : null,
    from: appPath(p.get("from")),
  };
}

/** A link to the Contact page with things filled in (Report this job: the topic, the job, why, where from). */
export function contactHref(prefill: Partial<{ topic: ContactTopic; listing: string; reason: string; from: string }> = {}): string {
  const q = new URLSearchParams();
  for (const key of ["topic", "listing", "reason", "from"] as const) {
    const value = prefill[key];
    if (value) q.set(key, value);
  }
  const text = q.toString();
  return text ? `${CONTACT_PAGE}?${text}` : CONTACT_PAGE;
}

/** The message a prefilled report starts with: the reason, ready for the details. */
export function startingMessage(prefill: ContactPrefill): string {
  return prefill.reason ? `${prefill.reason.replace(/[.!?]+$/, "")}. ` : "";
}

export interface ContactFields {
  name: string;
  email: string;
  phone: string;
  topic: ContactTopic | "";
  message: string;
}

export type FieldErrors = Partial<Record<keyof ContactFields, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+0-9 ()\-.]{7,32}$/;

/** What's wrong before sending, per field (empty when it's ready). The server checks the same again. */
export function fieldErrors(f: ContactFields): FieldErrors {
  const errors: FieldErrors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Tell us your name.";
  else if (name.length > NAME_MAX) errors.name = `At most ${NAME_MAX} characters.`;
  const email = f.email.trim();
  if (!email) errors.email = "We need an email to reply to.";
  else if (!EMAIL.test(email) || email.length > 320) errors.email = "That email doesn't look right.";
  const phone = f.phone.trim();
  const digits = phone.replace(/\D/g, "").length;
  if (phone && (!PHONE.test(phone) || digits < 7 || digits > 15)) errors.phone = "Use digits (with +91 if you like), or leave it empty.";
  if (!f.topic) errors.topic = "Pick what it's about.";
  const message = f.message.trim();
  if (message.length < MESSAGE_MIN) errors.message = `Write a little more: at least ${MESSAGE_MIN} characters.`;
  else if (f.message.length > MESSAGE_MAX) errors.message = `That's over ${MESSAGE_MAX.toLocaleString("en-IN")} characters. Shorten it a little.`;
  return errors;
}

/** The counter under the message box: "120 / 3,000", and whether it's past the limit. */
export function messageCounter(message: string): { text: string; over: boolean; near: boolean } {
  const n = message.length;
  return { text: `${n.toLocaleString("en-IN")} / ${MESSAGE_MAX.toLocaleString("en-IN")}`, over: n > MESSAGE_MAX, near: n > MESSAGE_MAX * 0.9 };
}

/** The request, trimmed, with only what's set. `website` is the honeypot's value (empty from a person). */
export function buildContactRequest(
  f: ContactFields,
  context: ContactContext | null,
  captchaToken: string | null,
  website = "",
): ContactRequest {
  const ctx = Object.fromEntries(Object.entries(context ?? {}).filter(([, v]) => typeof v === "string" && v.trim())) as ContactContext;
  return {
    name: f.name.trim(),
    email: f.email.trim(),
    topic: (f.topic || "general") as ContactTopic,
    message: f.message.trim(),
    ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
    ...(Object.keys(ctx).length ? { context: ctx } : {}),
    ...(captchaToken ? { captcha_token: captchaToken } : {}),
    ...(website ? { website } : {}),
  };
}

/** What went wrong, in words a person can act on. */
export function contactErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return err.message && !/slow down/i.test(err.message) ? err.message : "You've sent a few messages in a short time. Please wait a while and try again.";
    if (err.code === "captcha_failed") return "Please complete the security check and send again.";
    if (err.status === 0) return err.message;
    if (err.status === 422 || err.status === 400) return err.message;
  }
  return "Your message couldn't be sent just now. Please try again in a minute.";
}
