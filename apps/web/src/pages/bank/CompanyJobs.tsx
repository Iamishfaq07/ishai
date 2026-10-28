import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicCompanyJobs } from "@orbit/types";
import { ArrowUpRight, Briefcase, cx, focusRing } from "@orbit/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const link = cx("rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing);

function ago(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 30 ? `${days} days ago` : "Over a month ago";
}

/**
 * Open jobs at a guide's company, from Orbit's job cache (companies' own careers pages and the boards that allow it):
 * each opens the original post. Loaded in the browser, so the built page shows the way in rather than a stale list.
 */
export function CompanyJobs({ slug, name, compact = false }: { slug: string; name: string; compact?: boolean }) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<PublicCompanyJobs | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setJobs(null);
    setFailed(false);
    api.publicCompanyJobs(slug).then((out) => live && setJobs(out), () => live && setFailed(true));
    return () => { live = false; };
  }, [slug]);

  const more = user ? "/jobs/matches" : "/jobs";
  const items = compact ? jobs?.items.slice(0, 3) : jobs?.items;

  return (
    <section id="jobs" aria-labelledby={`jobs-${slug}`} className={cx("scroll-mt-24", compact ? "" : "rounded-2xl border mk-line mk-surface p-6")}>
      <h2 id={`jobs-${slug}`} className={cx(compact ? "text-sm font-semibold" : "mk-h3", "flex items-center gap-2 text-zinc-950 dark:text-white")}>
        <Briefcase className="h-4 w-4" aria-hidden /> Open jobs at {name}
      </h2>
      {!jobs && !failed && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" role="status">Looking for {name}'s open jobs…</p>}
      {failed && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">The open jobs didn't load. <Link to={more} className={link}>Search jobs in Orbit</Link></p>}
      {jobs && jobs.total === 0 && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          No {name} posts in Orbit's job search from the last 45 days. Check {name}'s careers page, or{" "}
          <Link to={more} className={link}>get matched to jobs like these</Link>.
        </p>
      )}
      {items && items.length > 0 && (
        <>
          <ul className={cx("divide-y mk-divide", compact ? "mt-2" : "mt-4")}>
            {items.map((j) => (
              <li key={`${j.title}|${j.place}|${j.posted_at}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="min-w-0">
                  {j.apply_url ? (
                    <a href={j.apply_url} target="_blank" rel="noopener" className={cx(link, "inline-flex items-center gap-1")}>
                      {j.title} <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="sr-only">(opens the original post in a new tab)</span>
                    </a>
                  ) : (
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{j.title}</span>
                  )}
                  <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                    {j.place}
                    {" · "}
                    {j.direct ? `${name}'s careers page` : j.credit ? <>via <a href={j.credit.url} target="_blank" rel="noopener" className={link}>{j.credit.label}</a></> : `via ${j.source_label}`}
                  </span>
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{ago(j.posted_at)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {jobs!.total > items.length ? `${jobs!.total} open in the last 45 days. ` : ""}
            <Link to={more} className={link}>{user ? "See how each matches your resume" : "Get matched to your resume, free"}</Link>
          </p>
        </>
      )}
    </section>
  );
}
