import { useEffect, useState } from "react";
import type { HiddenJob } from "@orbit/types";
import { EyeOff, cx, focusRing } from "@orbit/ui";
import { Card, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";

/**
 * The jobs and companies hidden from Discover ("Not interested"), each with a way back. Changes apply at once, apart
 * from the profile's Save. Shown only once something is hidden.
 */
export function HiddenSection() {
  const [items, setItems] = useState<HiddenJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.hiddenJobs().then((out) => setItems(out.items), (err: unknown) => setError(errorText(err)));
  }, []);

  const bringBack = async (item: HiddenJob) => {
    setBusy(`${item.kind}:${item.value}`);
    setError(null);
    try {
      await api.unhideJob(item.kind, item.value);
      setItems((all) => all?.filter((i) => !(i.kind === item.kind && i.value === item.value)) ?? null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  if (!error && !items?.length) return null;
  const companies = items?.filter((i) => i.kind === "company") ?? [];
  const jobs = items?.filter((i) => i.kind === "job") ?? [];
  const row = (item: HiddenJob) => (
    <li key={`${item.kind}:${item.value}`} className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0 break-words">{item.label}</span>
      <button type="button" disabled={busy !== null} onClick={() => void bringBack(item)}
        className={cx("shrink-0 rounded font-medium text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300", focusRing)}>
        Show again<span className="sr-only">: {item.label}</span>
      </button>
    </li>
  );

  return (
    <Card id="hidden" className="scroll-mt-24">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold"><EyeOff className="h-4 w-4 text-zinc-500" aria-hidden />Hidden jobs</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">You marked these Not interested, so they stay out of your matches and job alerts.</p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {companies.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Companies</h3>
          <ul className="divide-y divide-zinc-200 dark:divide-white/10">{companies.map(row)}</ul>
        </>
      )}
      {jobs.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold">Jobs</h3>
          <ul className="divide-y divide-zinc-200 dark:divide-white/10">{jobs.map(row)}</ul>
        </>
      )}
    </Card>
  );
}
