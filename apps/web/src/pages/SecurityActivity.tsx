import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SecurityEvent } from "@orbit/types";
import { Callout, LoadGate, Spot, buttonClass, cx } from "@orbit/ui";
import { Card, ErrorNote } from "../components/ui";
import { api } from "../lib/api";
import { errorText, formatDate } from "../lib/format";
import { acknowledgeSecurityChanges, acknowledgedAt, securityNotice } from "../lib/securityNotice";
import { useAsync } from "../lib/useAsync";

/** Settings → Recent security activity: the account's own recent changes to how it's signed in to (auth/alerts.py). */
export function SecurityActivityCard() {
  const activity = useAsync(() => api.securityActivity(), [], "security-activity");
  const items = activity.data?.items ?? [];
  return (
    <Card id="security-activity" className="scroll-mt-24">
      <h2 className="mb-1 flex items-center gap-3 font-semibold">
        <Spot kind="security" />
        Recent security activity
      </h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Changes to how your account is signed in to. Each one is also emailed to you. Don't recognise one? Reset your password, then check your passkeys and two-step sign-in above.
      </p>
      <LoadGate loading={activity.loading && !activity.data} variant="line" count={2} label="Loading your security activity">
        {activity.error && !activity.data ? (
          <ErrorNote onRetry={activity.reload}>{errorText(activity.error)}</ErrorNote>
        ) : items.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing yet. Adding a passkey, turning two-step sign-in on or off, or a new password shows here.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-white/10">
            {items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2.5 text-sm">
                <span className="font-medium">{e.text}</span>
                <time dateTime={e.at} className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  {formatDate(e.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </LoadGate>
    </Card>
  );
}

/**
 * Home: the newest serious change to the account's sign-in from the last fortnight, until "It was me" on this device.
 * The copy that always arrives, even when the server can't send email.
 */
export function SecurityNotice() {
  const [notice, setNotice] = useState<SecurityEvent | null>(null);
  useEffect(() => {
    let live = true;
    api
      .securityActivity()
      .then((a) => live && setNotice(securityNotice(a.items, acknowledgedAt())))
      .catch(() => undefined); // a notice that can't load just doesn't show
    return () => {
      live = false;
    };
  }, []);
  if (!notice) return null;
  const dismiss = () => {
    acknowledgeSecurityChanges(new Date(notice.at));
    setNotice(null);
  };
  return (
    <Callout
      tone="warning"
      title={`${notice.text} on ${formatDate(notice.at)}`}
      onDismiss={dismiss}
      action={
        <span className="flex flex-wrap gap-2">
          <button type="button" onClick={dismiss} className={buttonClass("secondary", "sm")}>
            It was me
          </button>
          <Link to="/forgot-password" className={cx(buttonClass("primary", "sm"))}>
            It wasn't me
          </Link>
        </span>
      }
    >
      If you didn't do this, reset your password now (that signs out every device), then check{" "}
      <Link to="/settings#security-activity" className="underline">
        Settings → Security
      </Link>
      .
    </Callout>
  );
}
