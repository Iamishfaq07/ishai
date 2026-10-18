// What stops an application: a captcha to solve, a sign-in wall, an email check, a block page, a closed posting.
// Each one is reported to the candidate to finish; none is ever worked around.
import type { ApplyReason } from "./contract";
import { shown, text } from "./dom";

const CAPTCHA_FRAME = /recaptcha\/(api2|enterprise)\/(bframe|anchor)|hcaptcha\.com|newassets\.hcaptcha|challenges\.cloudflare\.com|captcha/i;

function visibleText(doc: Document): string {
  const body = doc.body;
  if (!body) return "";
  const inner = (body as HTMLElement).innerText;
  return (typeof inner === "string" && inner ? inner : body.textContent ?? "").replace(/\s+/g, " ");
}

/** A captcha the person has to solve is on show: a challenge frame or checkbox widget (not the invisible badge,
 * which is satisfied silently), or a captcha interstitial page. */
export function captchaShown(doc: Document, formFound = true): boolean {
  for (const frame of doc.querySelectorAll("iframe")) {
    const src = frame.getAttribute("src") ?? "";
    const title = frame.getAttribute("title") ?? "";
    if (!CAPTCHA_FRAME.test(src) && !/captcha|challenge/i.test(title)) continue;
    if (frame.closest(".grecaptcha-badge")) continue;
    if (!shown(frame)) continue;
    const r = frame.getBoundingClientRect();
    if ((r.width < 30 || r.height < 30) && doc.documentElement.getBoundingClientRect().width > 0) continue;
    return true;
  }
  // Interstitial pages only: a job description may well mention "security checks".
  if (formFound) return false;
  const page = visibleText(doc).slice(0, 4000);
  if (/\b(verify (that )?you are (a )?human|are you a robot|i'?m not a robot|complete the captcha|solve the captcha|security check)\b/i.test(page)) return true;
  return /^just a moment/i.test(doc.title);
}

/** A sign-in wall: a visible password field, or a page that asks to sign in with no application form on it. */
export function loginWall(doc: Document, formFound: boolean): boolean {
  if ([...doc.querySelectorAll<HTMLInputElement>("input[type=password]")].some((i) => shown(i))) return true;
  if (formFound) return false;
  const heading = [...doc.querySelectorAll("h1, h2, h3, button, [role=button]")].filter((e) => shown(e)).map(text).join(" | ");
  return /\b(sign in|log in|login|create (an )?account) (to|and) (apply|continue)\b|^(sign in|log in)\b/im.test(heading);
}

/** The ATS asks the candidate to confirm their email (a code sent to them). */
export function emailVerification(doc: Document): boolean {
  const page = visibleText(doc);
  const asks = /\b(verification|security|confirmation) code\b|\bverify your email\b|\bcode (that )?(we|was) sent to\b|\bcheck your (email|inbox)\b/i.test(page);
  if (!asks) return false;
  return [...doc.querySelectorAll<HTMLInputElement>("input")].some(
    (i) => shown(i) && (i.autocomplete === "one-time-code" || /code|otp|security|verif/i.test(`${i.name} ${i.id} ${i.getAttribute("aria-label") ?? ""}`)),
  );
}

/** A block or anti-abuse page (not a captcha): access denied, rate limited, flagged as spam. */
export function blockedPage(doc: Document): boolean {
  // Only checked when there is no form: job descriptions can mention "suspicious activity" too.
  const page = visibleText(doc).slice(0, 6000);
  return /\b(access denied|request (was )?blocked|you have been blocked|too many requests|unusual traffic|flagged as (possible )?spam|suspicious activity)\b/i.test(page) || /^(403|429)\b|access denied/i.test(doc.title);
}

/** The posting no longer takes applications. */
export function postingClosed(doc: Document): boolean {
  const page = visibleText(doc).slice(0, 6000);
  return /\b(no longer (accepting applications|available|open)|position has been filled|job (posting )?(is )?(closed|not found)|couldn'?t find anything here|page (you were looking for )?(does not|doesn'?t) exist|this job is no longer)\b/i.test(page);
}

/** The first stop condition on the page now, if any. */
export function blocker(doc: Document, formFound: boolean): ApplyReason | null {
  if (captchaShown(doc, formFound)) return "captcha";
  if (emailVerification(doc)) return "email_verification";
  if (loginWall(doc, formFound)) return "login";
  if (!formFound && blockedPage(doc)) return "blocked";
  return null;
}
