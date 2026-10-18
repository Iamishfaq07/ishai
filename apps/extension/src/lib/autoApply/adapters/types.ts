import type { Ats } from "../contract";
import type { Question } from "../questions";

/** One applicant tracking system's hosted application form: how to find its questions, submit it, and tell whether
 * it was accepted. Built on the shared question model and field detection. */
export interface Adapter {
  ats: Ats;
  /** Hostnames it runs on (and that the optional host permissions cover). */
  hosts: string[];
  /** The application form once it's rendered, else null. */
  form(doc: Document): Element | null;
  /** The questions in the form, in page order (hidden ones included: the engine skips what isn't on show). */
  questions(form: Element): Question[];
  submitButton(form: Element): HTMLElement | null;
  /** The ATS's own success state: its confirmation text, else null. Never inferred from a missing form alone. */
  success(doc: Document): string | null;
  /** Validation or submission errors on show. */
  errors(doc: Document): string[];
  /** Whether a chosen file has been taken by the page: shown as attached, still working, or refused. */
  upload(q: Question, filename: string): "ok" | "pending" | "failed";
  /** The page is busy (e.g. reading the resume to autofill): wait before typing. */
  busy(doc: Document): boolean;
  /** After typing into a field that offers suggestions (a location), pick the one that matches exactly, if any. */
  afterType?(q: Question, value: string): Promise<void>;
}
