import { useEffect, useState } from "react";
import type { JobAlert, JobAlertFrequency } from "@orbit/types";
import { Spot, cx, focusRing } from "@orbit/ui";
import { Card, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

const CHOICES: Array<{ id: JobAlertFrequency; label: string }> = [
  { id: "off", label: "Off" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
];

/**
 * Job alerts: an email of the new jobs that match this profile, daily or weekly. Saved as soon as it's picked (it's
 * separate from the profile's Save), and each email has a one-click way to stop them.
 */
export function AlertsSection({ onProfileSaved }: { onProfileSaved: () => void }) {
  const [alert, setAlert] = useState<JobAlert | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  useEffect(() => {
    api.jobAlert().then(setAlert, (err: unknown) => setError(errorText(err)));
  }, []);

  const pick = async (frequency: JobAlertFrequency) => {
    if (!alert || frequency === alert.frequency) return;
    setBusy(true);
    setError(null);
    try {
      setAlert(await api.setJobAlert(frequency));
      onProfileSaved(); // turning alerts on saves the profile the feed was using
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="alerts" className="scroll-mt-24">
      <div className="mb-4 flex items-center gap-3">
        <Spot kind="alert" />
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">Email me new matches</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Jobs that are new since the last email and a good match for this profile. Nothing new, no email.</p>
        </div>
      </div>
      {alert && (
        <>
          <div role="radiogroup" aria-label="How often" className="inline-flex rounded-full bg-zinc-500/10 p-1">
            {CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={alert.frequency === c.id}
                disabled={busy}
                onClick={() => void pick(c.id)}
                className={cx(
                  "rounded-full px-4 py-1 text-sm font-medium transition-colors",
                  alert.frequency === c.id
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                  focusRing,
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {alert.frequency === "off"
              ? `Sent to ${alert.email}.`
              : `${alert.frequency === "daily" ? "Once a day" : "Once a week"} to ${alert.email}. Changes to your profile apply to the next email.`}
          </p>
          {alert.frequency !== "off" && !alert.can_email && (
            <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              Confirm your email address first: alerts go only to a confirmed address.{" "}
              {linkSent ? (
                "The link is on its way: open it, and alerts start."
              ) : (
                <button
                  type="button"
                  className={cx("font-medium underline underline-offset-2", focusRing)}
                  onClick={() => api.requestVerification().then(() => setLinkSent(true), (err: unknown) => setError(errorText(err)))}
                >
                  Send me the link
                </button>
              )}
            </p>
          )}
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}
