// The product pages' questions and answers (DECISIONS D79): the one list both the page (marketing/kit/FaqBlock) and its
// FAQPage structured data (site.js) are made from, so the markup states exactly what the page shows (D67). Plain text
// only, the same for every visitor (no prices, counts or regional wording that the page would show differently), and
// only what the product really does: each answer was checked against the code it describes.
//
// Each page has its own module in faqs/ and imports it directly, so its bundle carries only its own questions; the
// Worker and the built pages read them all through PAGE_FAQS.
import { RESUME_AI_FAQ } from "./faqs/resume-ai.js";
import { JOBS_AI_FAQ } from "./faqs/jobs.js";
import { LINKEDIN_AI_FAQ } from "./faqs/linkedin-ai.js";
import { COPILOT_FAQ } from "./faqs/interview-copilot.js";
import { PRACTICE_FAQ } from "./faqs/mock-interview.js";
import { BUSINESS_FAQ } from "./faqs/business.js";
import { WARMUP_FAQ } from "./faqs/warmup.js";

export { RESUME_AI_FAQ, JOBS_AI_FAQ, LINKEDIN_AI_FAQ, COPILOT_FAQ, PRACTICE_FAQ, BUSINESS_FAQ, WARMUP_FAQ };

/** @type {Record<string, ReadonlyArray<readonly [string, string]>>} */
export const PAGE_FAQS = {
  "/resume-ai": RESUME_AI_FAQ,
  "/jobs": JOBS_AI_FAQ,
  "/linkedin-ai": LINKEDIN_AI_FAQ,
  "/interview-copilot": COPILOT_FAQ,
  "/mock-interview": PRACTICE_FAQ,
  "/business": BUSINESS_FAQ,
  "/warmup": WARMUP_FAQ,
};

/** The questions a page shows, or none. */
export function faqsFor(path) {
  return Object.prototype.hasOwnProperty.call(PAGE_FAQS, path) ? PAGE_FAQS[path] : [];
}
