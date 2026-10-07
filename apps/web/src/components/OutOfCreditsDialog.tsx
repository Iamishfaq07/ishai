import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, cx, focusRing, useFocusTrap } from "@orbit/ui";
import { onOutOfCredits, type OutOfCredits } from "../lib/outOfCredits";

const COPY = {
  resume: {
    title: "You're out of AI credits",
    body: "Each AI action in Resume AI and Jobs AI (an import, a rewrite, tailoring, a cover letter, outreach or interview prep) uses 1 credit. Typing, the ATS score and downloads stay free.",
    action: "Get credits",
  },
  minutes: {
    title: "You're out of interview minutes",
    body: "Live interviews and mock practice use interview minutes. Get a pack to keep going.",
    action: "Get minutes",
  },
} as const;

const rupees = (n: number): string => `₹${n.toLocaleString("en-IN")}`;

/** The app's one "out of credits" popup (lib/outOfCredits.ts says when). Mount once inside the router. */
export function OutOfCreditsHost() {
  const [open, setOpen] = useState<OutOfCredits | null>(null);
  const actionRef = useRef<HTMLAnchorElement>(null);

  // While it's open, a second refusal (a retry, two AI calls at once) doesn't stack another dialog.
  useEffect(() => onOutOfCredits((event) => setOpen((now) => now ?? event)), []);

  const close = () => setOpen(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(open !== null, { onEscape: close, initialFocus: () => actionRef.current });

  if (!open) return null;
  const copy = COPY[open.kind];
  const offer = open.offer;
  const adds = offer
    ? [offer.resume_credits && `${offer.resume_credits} AI credits`, offer.interview_minutes && `${offer.interview_minutes} interview minutes`]
        .filter(Boolean)
        .join(" and ")
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="orbit-credits-title"
        aria-describedby="orbit-credits-body"
        className="w-full max-w-sm animate-fade-up rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300" aria-hidden>
            <Crown className="h-5 w-5" />
          </span>
          <h2 id="orbit-credits-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {copy.title}
          </h2>
        </div>
        <div id="orbit-credits-body" className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
          {open.note && <p className="font-medium text-zinc-800 dark:text-zinc-100">{open.note}</p>}
          <p>{copy.body}</p>
          {offer && adds && (
            <p>
              The {offer.label} pack adds {adds} for {rupees(offer.price_inr)}. They never expire.
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className={cx("rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800", focusRing)}
          >
            Not now
          </button>
          <Link
            ref={actionRef}
            to={`/billing${offer ? `?pack=${encodeURIComponent(offer.pack)}` : ""}`}
            onClick={close}
            className={cx("inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500", focusRing)}
          >
            <Crown className="h-4 w-4" aria-hidden />
            {copy.action}
          </Link>
        </div>
      </div>
    </div>
  );
}
