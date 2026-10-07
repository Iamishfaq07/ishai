/**
 * "You're out of credits", said once for the whole app: any API reply that means the account has run out (a resume AI
 * action's `402 upgrade_required`, or a session refused for lack of interview minutes) opens the out-of-credits dialog
 * (components/OutOfCreditsDialog.tsx), wherever it was asked from. A page can also open it itself, e.g. when the
 * server answered with only the fixes that need no AI.
 */

export type OutOfCreditsKind = "resume" | "minutes";

/** The cheapest pack the server offered with its 402 (the `upgrade` fields of resumes/allowance.py), if any. */
export interface CreditsOffer {
  pack: string;
  label: string;
  price_inr: number;
  resume_credits: number;
  interview_minutes: number;
}

export interface OutOfCredits {
  kind: OutOfCreditsKind;
  offer?: CreditsOffer;
  /** What was still done without the AI ("The fixes that need no AI are done."), shown above the offer. */
  note?: string;
}

type Listener = (event: OutOfCredits) => void;
const listeners = new Set<Listener>();

export function onOutOfCredits(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function announceOutOfCredits(event: OutOfCredits): void {
  for (const listener of listeners) listener(event);
}

function offerFrom(detail: Record<string, unknown>): CreditsOffer | undefined {
  const { pack, label, price_inr, resume_credits, interview_minutes } = detail;
  if (typeof pack !== "string" || typeof price_inr !== "number") return undefined;
  return {
    pack,
    label: typeof label === "string" ? label : pack,
    price_inr,
    resume_credits: typeof resume_credits === "number" ? resume_credits : 0,
    interview_minutes: typeof interview_minutes === "number" ? interview_minutes : 0,
  };
}

/** Starting a session (POST /v1/sessions) is the one minutes 402 not shown in place: live and mock sessions already
 *  explain a refused ticket in their own panel. A document-count 402 isn't about credits at all. */
const SESSION_CREATE = /\/v1\/sessions\/?$/;

function pathOf(input: RequestInfo | URL): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(url, "http://x").pathname;
  } catch {
    return url;
  }
}

/** What a 402 reply means for the dialog, or null when it's some other limit. */
export function outOfCreditsFrom(path: string, method: string, body: unknown): OutOfCredits | null {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === "object" && (detail as { code?: unknown }).code === "upgrade_required") {
    return { kind: "resume", offer: offerFrom(detail as Record<string, unknown>) };
  }
  if (method.toUpperCase() === "POST" && SESSION_CREATE.test(path)) return { kind: "minutes" };
  return null;
}

/** `fetch`, watching every reply for "out of credits". The reply itself goes back to the caller untouched. */
export function watchForOutOfCredits(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.status === 402) {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      void response
        .clone()
        .json()
        .catch(() => null)
        .then((body: unknown) => {
          const event = outOfCreditsFrom(pathOf(input), method, body);
          if (event) announceOutOfCredits(event);
        });
    }
    return response;
  };
}
