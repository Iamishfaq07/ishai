import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ResumeAiAllowance } from "@orbit/types";
import { ApiError, Crown, Sparkles, cx, focusRing } from "@orbit/ui";
import { useBackend } from "./backend";

/**
 * The resume AI's credits. On the Free plan each AI action (import, tailoring, cover letter, a whole-resume rewrite)
 * spends one resume credit: the welcome credit, then credits from a pack. A single fix (one ATS check, one section)
 * costs a fraction: one credit covers `fixes_per_credit` of them. The server enforces it (`402 upgrade_required`) and
 * says what's left (`/allowance`); the editor shows it, offers a pack, and refreshes it after each AI call.
 */
export interface AllowanceState {
  allowance: ResumeAiAllowance | null;
  refresh: () => void;
}

export const AllowanceContext = createContext<AllowanceState>({ allowance: null, refresh: () => undefined });
export const useAllowance = (): AllowanceState => useContext(AllowanceContext);

export function useResumeAllowance(): AllowanceState {
  const backend = useBackend();
  const [allowance, setAllowance] = useState<ResumeAiAllowance | null>(null);
  const refresh = useCallback(() => {
    backend.tools
      .resumeAllowance()
      .then(setAllowance)
      .catch(() => undefined); // an older server without the endpoint: no credits shown, the AI still answers
  }, [backend]);
  useEffect(refresh, [refresh]);
  return { allowance, refresh };
}

/** The server said there are no resume credits left. */
export const isUpgradeError = (err: unknown): boolean => err instanceof ApiError && err.code === "upgrade_required";

/** "₹499", or nothing without a price. */
export function priceText(price: number | null | undefined): string {
  return price ? `₹${price}` : "";
}

/** Where buying credits starts: Plan & billing, with the cheapest pack that has resume credits opened. */
export function UpgradeLink({ className, children }: { className?: string; children?: ReactNode }) {
  const { allowance } = useAllowance();
  const offer = allowance?.upgrade;
  return (
    <Link
      to={`/billing?pack=${offer?.pack ?? ""}`}
      className={cx(
        // Dark text on amber: white on amber-500 is 2.1:1, amber-950 on amber-400 is 9:1.
        "inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 py-1.5 text-sm font-medium text-amber-950 shadow-sm hover:bg-amber-300",
        focusRing,
        className,
      )}
    >
      <Crown className="h-4 w-4" />
      {children ?? (offer ? `Get credits · from ${(offer.price_text ?? priceText(offer.price_inr))}` : "Get credits")}
    </Link>
  );
}

/** How many single AI fixes one credit covers (1 on an older server). */
export const fixesPerCredit = (a: ResumeAiAllowance | null): number => Math.max(1, a?.fixes_per_credit ?? 1);

/** Single AI fixes this account can still make: the ones already paid for, plus what its credits cover. */
export function fixesLeft(a: ResumeAiAllowance): number {
  return (a.fixes_left ?? 0) + a.credits_left * fixesPerCredit(a);
}

/** What an AI action costs right now, for the line under AI buttons. `fix`: a single fix (a fraction of a credit). */
export function AiCostNote({ className, fix = false }: { className?: string; fix?: boolean }) {
  const { allowance } = useAllowance();
  if (!allowance || allowance.unlimited) return null;
  const per = fixesPerCredit(allowance);
  let text: string;
  if (fix && per > 1 && fixesLeft(allowance) > 0) {
    text = `Each AI fix uses 1/${per} of a resume credit. You have ${fixesLeft(allowance)} fix${fixesLeft(allowance) === 1 ? "" : "es"} left.`;
  } else if (allowance.credits_left > 0) {
    text = `Uses 1 resume credit. You have ${allowance.credits_left}.`;
  } else {
    text = "You're out of resume credits. Fixes that need no AI (skills, dates) stay free.";
  }
  return <p className={cx("text-xs text-zinc-500 dark:text-zinc-400", className)}>{text}</p>;
}

/** The editor's banner: resume credits left, and what a pack adds. Hidden on plans with unlimited resume AI. */
export function AllowanceBanner() {
  const { allowance } = useAllowance();
  if (!allowance || allowance.unlimited) return null;
  const left = allowance.credits_left;
  const offer = allowance.upgrade;
  if (left > 0) {
    // Credits left: a quiet line, short on phones (where the full sentence took a third of the first screen), the
    // whole explanation from 640 px up. Out of credits, the full amber note below.
    return (
      <div role="note" className="mb-4 flex items-center gap-3 rounded-xl bg-zinc-500/5 px-3 py-2 text-sm text-zinc-700 ring-1 ring-zinc-500/15 dark:text-zinc-300">
        <Sparkles className="h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-300" aria-hidden />
        <span className="min-w-0 flex-1">
          <strong>{`${left} resume credit${left === 1 ? "" : "s"} left.`}</strong>
          <span className="sm:hidden"> AI actions use one; the rest is free.</span>
          <span className="hidden sm:inline">
            {" "}
            Each AI import, tailoring, cover letter, whole-resume rewrite, profile or message uses one
            {fixesPerCredit(allowance) > 1 ? `, and one covers ${fixesPerCredit(allowance)} single AI fixes` : ""}; typing, the ATS score and downloads are free.
            {offer && ` The ${offer.label} pack adds ${offer.resume_credits} credits${offer.interview_minutes ? ` and ${offer.interview_minutes} interview minutes` : ""} for ${(offer.price_text ?? priceText(offer.price_inr))}, and they never expire.`}
          </span>
        </span>
        <UpgradeLink className="shrink-0 !px-2.5 !py-1 !text-xs sm:!px-3 sm:!py-1.5 sm:!text-sm">
          <span className="sm:hidden">Get credits</span>
          <span className="hidden sm:inline">{offer ? `Get credits · from ${(offer.price_text ?? priceText(offer.price_inr))}` : "Get credits"}</span>
        </UpgradeLink>
      </div>
    );
  }
  return (
    <div
      role="note"
      className={cx(
        "mb-4 flex flex-col gap-2 rounded-xl p-3 text-sm ring-1 sm:flex-row sm:items-center sm:gap-3",
        left <= 0
          ? "bg-amber-500/10 text-amber-950 ring-amber-500/30 dark:text-amber-100"
          : "bg-zinc-500/5 text-zinc-700 ring-zinc-500/15 dark:text-zinc-300",
      )}
    >
      <Sparkles className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden />
      <span className="min-w-0 sm:flex-1">
        <strong>
          {left <= 0 ? "You're out of resume credits." : `${left} resume credit${left === 1 ? "" : "s"} left.`}
        </strong>{" "}
        Each AI import, tailoring, cover letter, whole-resume rewrite, profile or message uses one
        {fixesPerCredit(allowance) > 1 ? `, and one covers ${fixesPerCredit(allowance)} single AI fixes` : ""}; typing, the ATS score and downloads are free.
        {offer && ` The ${offer.label} pack adds ${offer.resume_credits} credits${offer.interview_minutes ? ` and ${offer.interview_minutes} interview minutes` : ""} for ${(offer.price_text ?? priceText(offer.price_inr))}, and they never expire.`}
      </span>
      <UpgradeLink className="shrink-0" />
    </div>
  );
}

/** An AI error, with the button to get credits when that's what it is. */
export function AiErrorNote({ error, upgrade, className }: { error: string; upgrade: boolean; className?: string }) {
  return (
    <div role="status" className={cx("text-sm", upgrade ? "space-y-2" : "", className)}>
      <p className={upgrade ? "text-amber-900 dark:text-amber-200" : "text-zinc-600 dark:text-zinc-300"}>{error}</p>
      {upgrade && <UpgradeLink />}
    </div>
  );
}
