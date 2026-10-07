import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ResumeAiAllowance } from "@orbit/types";
import { ApiError, Crown, Sparkles, cx, focusRing } from "@orbit/ui";
import { useBackend } from "./backend";

/**
 * The resume AI's credits. On the Free plan each AI action (import, rewrite, tailoring, cover letter) spends one
 * resume credit: the welcome credit, then credits from a pack. The server enforces it (`402 upgrade_required`) and
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
        "inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-amber-600",
        focusRing,
        className,
      )}
    >
      <Crown className="h-4 w-4" />
      {children ?? (offer ? `Get credits · from ${priceText(offer.price_inr)}` : "Get credits")}
    </Link>
  );
}

/** What an AI action costs right now, for the line under AI buttons. */
export function AiCostNote({ className }: { className?: string }) {
  const { allowance } = useAllowance();
  if (!allowance || allowance.unlimited) return null;
  return (
    <p className={cx("text-xs text-zinc-500 dark:text-zinc-400", className)}>
      {allowance.credits_left > 0
        ? `Uses 1 resume credit. You have ${allowance.credits_left}.`
        : "You're out of resume credits. Fixes that need no AI (skills, dates) stay free."}
    </p>
  );
}

/** The editor's banner: resume credits left, and what a pack adds. Hidden on plans with unlimited resume AI. */
export function AllowanceBanner() {
  const { allowance } = useAllowance();
  if (!allowance || allowance.unlimited) return null;
  const left = allowance.credits_left;
  const offer = allowance.upgrade;
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
        Each AI import, rewrite, tailoring, cover letter, profile or message uses one; typing, the ATS score and downloads are free.
        {offer && ` The ${offer.label} pack adds ${offer.resume_credits} credits${offer.interview_minutes ? ` and ${offer.interview_minutes} interview minutes` : ""} for ${priceText(offer.price_inr)}, and they never expire.`}
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
