// Types for faqs.js, so the web app's TypeScript (the product pages, the build-time prerender and its tests) can import it.
/** One question and its answer, plain text, exactly as the page shows them. */
export type Faq = readonly [question: string, answer: string];
export const RESUME_AI_FAQ: ReadonlyArray<Faq>;
export const JOBS_AI_FAQ: ReadonlyArray<Faq>;
export const LINKEDIN_AI_FAQ: ReadonlyArray<Faq>;
export const COPILOT_FAQ: ReadonlyArray<Faq>;
export const PRACTICE_FAQ: ReadonlyArray<Faq>;
export const PAGE_FAQS: Record<string, ReadonlyArray<Faq>>;
export function faqsFor(path: string): ReadonlyArray<Faq>;
