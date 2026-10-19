import { Link } from "react-router-dom";
import { PlugZap, cx } from "@orbit/ui";
import { linkButton } from "../links";
import { executorState } from "./model";

/** The web app's /extension/connect page: installs (once it's listed) and connects the Orbit browser extension. */
export const EXTENSION_CONNECT = "/extension/connect";

/**
 * Orbit Apply prepares applications on the server, but only the Orbit browser extension sends them, from the
 * candidate's own browser, once they switch on "Apply for me automatically" in its popup. This says so, and whether
 * that extension has been asking for work (`executor_seen_at`).
 */
export function ExtensionNeeded({ seenAt, compact = false }: { seenAt: string | null | undefined; compact?: boolean }) {
  const state = executorState(seenAt);
  if (state === "on") {
    if (compact) return null;
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300" data-testid="extension-state" data-state="on">
        <PlugZap className="h-4 w-4" aria-hidden /> Your Orbit browser extension is on and applying (last checked in{" "}
        {new Date(seenAt!).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}).
      </p>
    );
  }
  return (
    <div
      role="note"
      data-testid="extension-state"
      data-state={state}
      className={cx("rounded-xl border p-4 text-sm", "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100")}
    >
      <p className="font-semibold">
        {state === "never" ? "External employer forms use the Orbit browser extension" : "Your Orbit browser extension hasn't checked in for a while"}
      </p>
      <p className="mt-1">
        {state === "never"
          ? "Direct Orbit Business applications can submit under your approved rules without the extension. For supported external forms, install and connect it, then switch on “Apply for me automatically” in its popup."
          : `It last asked for work on ${new Date(seenAt!).toLocaleDateString([], { day: "numeric", month: "short" })}. External forms need that browser open with automatic applying switched on. Direct Orbit Business applications do not need an open browser.`}
      </p>
      <Link to={EXTENSION_CONNECT} className={cx(linkButton("secondary", "sm"), "mt-3 inline-flex")}>
        <PlugZap className="h-4 w-4" aria-hidden /> {state === "never" ? "Get and connect the extension" : "Check the extension"}
      </Link>
    </div>
  );
}
