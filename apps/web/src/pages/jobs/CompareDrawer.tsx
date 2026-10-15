import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { Check, CompanyLogo, LoadGate, Sheet, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { compareRows, type CompareJob } from "./compare";
import { jobPath } from "./paths";

/** "A", "A and B", "A, B and C". */
function andList(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Two or three tracked jobs side by side (pages/jobs/compare.ts): what each post states, the skills match, the fit
 * check and where you are with each. The best on a row is marked, never a tie. A post Orbit no longer has compares
 * from the tracker alone.
 */
export function CompareDrawer({ entries, open, onClose }: { entries: JobTrackerEntry[]; open: boolean; onClose: () => void }) {
  const [jobs, setJobs] = useState<CompareJob[] | null>(null);
  const key = entries.map((e) => e.id).join();
  useEffect(() => {
    if (!open) return;
    let live = true;
    setJobs(null);
    void Promise.all(
      entries.map(async (entry) => ({ entry, detail: entry.live ? await api.jobListing(entry.listing_id).catch(() => null) : null })),
    ).then((loaded) => live && setJobs(loaded));
    return () => {
      live = false;
    };
    // `key` stands for the entries: the same jobs aren't loaded twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);
  const rows = jobs ? compareRows(jobs) : [];
  const unchecked = jobs?.filter((j) => j.detail && !j.detail.fit) ?? [];
  return (
    <Sheet open={open} onClose={onClose} title={`Compare ${entries.length} jobs`} placement="end" size="2xl">
      <LoadGate loading={!jobs} variant="card" count={2} label="Loading the jobs">
        {jobs && (
          <div className="space-y-4 p-4 sm:p-5">
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-sm">
                <caption className="sr-only">The jobs side by side. A check mark is the best of them on that row.</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-24 pb-3 sm:w-32 text-left align-bottom text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      <span className="sr-only">What</span>
                    </th>
                    {jobs.map(({ entry }) => (
                      <th key={entry.id} scope="col" className="pb-3 pl-3 text-left align-bottom font-normal">
                        <span className="flex items-start gap-2">
                          <CompanyLogo company={entry.company} size="md" />
                          <span className="min-w-0">
                            {entry.live ? (
                              <Link to={jobPath(entry.listing_id)} className={cx("block font-semibold leading-snug hover:text-indigo-600 dark:hover:text-indigo-300", focusRing)}>
                                {entry.title}
                              </Link>
                            ) : (
                              <span className="block font-semibold leading-snug">{entry.title}</span>
                            )}
                            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{entry.company}</span>
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row" className="border-t border-zinc-200 py-2 pr-2 text-left align-top text-xs font-medium text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                        {r.label}
                      </th>
                      {r.values.map((v, i) => {
                        const best = r.best.includes(i);
                        return (
                          <td
                            key={i}
                            className={cx(
                              "border-t border-zinc-200 py-2 pl-3 align-top dark:border-white/10",
                              best && "bg-emerald-500/[0.07] font-medium text-emerald-900 dark:text-emerald-200",
                            )}
                          >
                            {v ?? <span className="text-zinc-400 dark:text-zinc-500">Not stated</span>}
                            {best && (
                              <>
                                <Check className="ml-1 inline h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                                <span className="sr-only"> (best of these)</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {unchecked.length > 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No fit check yet for {andList(unchecked.map((j) => j.entry.company))}. Run one from{" "}
                {unchecked.length === 1 ? "the job's page" : "each job's page"} to compare requirement by requirement.
              </p>
            )}
          </div>
        )}
      </LoadGate>
    </Sheet>
  );
}
