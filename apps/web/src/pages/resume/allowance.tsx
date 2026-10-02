import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ResumeAiAllowance } from "@orbit/types";
import { ApiError, Crown, Sparkles, cx, focusRing } from "@orbit/ui";
import { useBackend } from "./backend";

/**
 * The resume AI's free allowance. Without Resume Pro there's one free AI action (per account, and per network); the
 * server enforces it (`402 upgrade_required`) and says what's left (`/allowance`). The editor shows it, offers the
 * upgrade, and refreshes it after each AI call.
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
      .catch(() => undefined); // an older server without the endpoint: no allowance shown, the AI still answers
  }, [backend]);
  useEffect(refresh, [refresh]);
  return { allowance, refresh };
}

/** The server said the free AI use is spent. */
export const isUpgradeError = (err: unknown): boolean => err instanceof ApiError && err.code === "upgrade_required";

/** "₹299/month", or nothing when the plan has no rupee price. */
export function priceText(price: number | null | undefined): string {
  return price ? `₹${price}/month` : "";
}

/** Where upgrading starts: the billing page with Resume Pro picked, or (signed out) making an account first. */
export function UpgradeLink({ className, children }: { className?: string; children?: ReactNode }) {
  const backend = useBackend();
  const { allowance } = useAllowance();
  const plan = allowance?.upgrade.plan ?? "resume_pro";
  const to = backend.guest ? "/register" : `/billing?plan=${plan}`;
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-amber-600",
        focusRing,
        className,
      )}
    >
      <Crown className="h-4 w-4" />
      {children ?? (backend.guest ? "Create an account to upgrade" : `Upgrade${allowance?.upgrade.price_inr_month ? ` · ${priceText(allowance.upgrade.price_inr_month)}` : ""}`)}
    </Link>
  );
}

/** What an AI action costs right now, for the line under AI buttons: nothing on Resume Pro, the free use, or Upgrade. */
export function AiCostNote({ className }: { className?: string }) {
  const { allowance } = useAllowance();
  if (!allowance || allowance.unlimited) return null;
  return (
    <p className={cx("text-xs text-zinc-500 dark:text-zinc-400", className)}>
      {allowance.free_left > 0
        ? "This uses your 1 free AI edit."
        : "You've used your free AI edit. Fixes that need no AI (skills, dates) stay free."}
    </p>
  );
}

/** The editor's banner: how much free AI is left, and what Resume Pro adds. Hidden on Resume Pro. */
export function AllowanceBanner() {
  const { allowance } = useAllowance();
  if (!allowance || allowance.unlimited) return null;
  const spent = allowance.free_left <= 0;
  const label = allowance.upgrade.label;
  return (
    <div
      role="note"
      className={cx(
        "mb-4 flex flex-col gap-2 rounded-xl p-3 text-sm ring-1 sm:flex-row sm:items-center sm:gap-3",
        spent
          ? "bg-amber-500/10 text-amber-950 ring-amber-500/30 dark:text-amber-100"
          : "bg-zinc-500/5 text-zinc-700 ring-zinc-500/15 dark:text-zinc-300",
      )}
    >
      <Sparkles className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden />
      <span className="min-w-0 sm:flex-1">
        {spent ? (
          <>
            <strong>You've used your free AI edit.</strong> {label} unlocks unlimited AI rewrites, tailoring to each job,
            imports and cover letters. Typing, the ATS score and downloads stay free.
          </>
        ) : (
          <>
            <strong>1 free AI edit included.</strong> Use it on an import, a rewrite, tailoring or a cover letter.{" "}
            {label} makes the AI unlimited.
          </>
        )}
      </span>
      <UpgradeLink className="shrink-0" />
    </div>
  );
}

/** An AI error, with the upgrade button when it's the free use running out. */
export function AiErrorNote({ error, upgrade, className }: { error: string; upgrade: boolean; className?: string }) {
  return (
    <div role="status" className={cx("text-sm", upgrade ? "space-y-2" : "", className)}>
      <p className={upgrade ? "text-amber-900 dark:text-amber-200" : "text-zinc-600 dark:text-zinc-300"}>{error}</p>
      {upgrade && <UpgradeLink />}
    </div>
  );
}
