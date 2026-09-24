import { useState } from "react";
import { cx, focusRing } from "./cx";

/**
 * Shown while the signed-in user hasn't verified their email. Live sessions, screenshots, mock interviews and
 * AI review are locked until they do (the API answers 403 `email_unverified`). "I've verified" re-reads the
 * account — the link opens in the browser, so the desktop app can't see the click itself.
 */
export function VerifyEmailBanner({
  email,
  onResend,
  onRecheck,
  className,
}: {
  email: string;
  onResend: () => Promise<unknown>;
  onRecheck?: () => Promise<boolean>;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "checking">("idle");
  const [note, setNote] = useState<string | null>(null);

  const resend = () => {
    setState("sending");
    setNote(null);
    onResend()
      .then(() => setState("sent"))
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "Couldn't send the link.");
        setState("idle");
      });
  };
  const recheck = () => {
    if (!onRecheck) return;
    setState("checking");
    setNote(null);
    onRecheck()
      .then((verified) => {
        if (!verified) setNote("Not verified yet — open the link in the email first.");
        setState("idle");
      })
      .catch(() => setState("idle"));
  };

  const link = cx("font-medium underline underline-offset-2 disabled:opacity-50", focusRing);
  return (
    <div
      role="status"
      className={cx(
        "border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0">
          Verify <strong className="break-all">{email}</strong> to start live sessions, screenshots and mock interviews.
        </span>
        {state === "sent" ? (
          <span className="font-medium">New link sent.</span>
        ) : (
          <button type="button" onClick={resend} disabled={state !== "idle"} className={link}>
            {state === "sending" ? "Sending…" : "Resend link"}
          </button>
        )}
        {onRecheck && (
          <button type="button" onClick={recheck} disabled={state === "checking" || state === "sending"} className={link}>
            {state === "checking" ? "Checking…" : "I've verified"}
          </button>
        )}
        {note && <span className="text-rose-700 dark:text-rose-300">{note}</span>}
      </div>
    </div>
  );
}
