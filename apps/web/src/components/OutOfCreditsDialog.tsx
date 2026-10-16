import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, buttonClass } from "@orbit/ui";
import { onOutOfCredits, type OutOfCredits } from "../lib/outOfCredits";
import { Sheet } from "./Sheet";

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

  // While it's open, a second refusal (a retry, two AI calls at once) doesn't stack another dialog.
  useEffect(() => onOutOfCredits((event) => setOpen((now) => now ?? event)), []);

  const close = () => setOpen(null);
  if (!open) return null;
  const copy = COPY[open.kind];
  const offer = open.offer;
  const adds = offer
    ? [offer.resume_credits && `${offer.resume_credits} AI credits`, offer.interview_minutes && `${offer.interview_minutes} interview minutes`]
        .filter(Boolean)
        .join(" and ")
    : "";

  return (
    <Sheet
      open
      onClose={close}
      title={copy.title}
      titleId="orbit-credits-title"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={buttonClass("ghost", "sm")}>
            Not now
          </button>
          <Link
            to={`/billing${offer ? `?pack=${encodeURIComponent(offer.pack)}` : ""}`}
            onClick={close}
            className={buttonClass("primary", "sm")}
          >
            <Crown className="h-4 w-4" aria-hidden />
            {copy.action}
          </Link>
        </div>
      }
    >
      <div id="orbit-credits-body" className="space-y-2 px-5 py-4 text-sm text-zinc-600 dark:text-zinc-300">
        {open.note && <p className="font-medium text-zinc-800 dark:text-zinc-100">{open.note}</p>}
        <p>{copy.body}</p>
        {offer && adds && (
          <p>
            The {offer.label} pack adds {adds} for {offer.price_text ?? rupees(offer.price_inr)}. They never expire.
          </p>
        )}
      </div>
    </Sheet>
  );
}
