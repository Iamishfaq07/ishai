import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useOutletContext, useSearchParams } from "react-router-dom";
import type { JobProfile, JobSort, JobTrackerEntry } from "@orbit/types";
import { Skeleton } from "@orbit/ui";
import { api } from "../../lib/api";
import { useAsync, type AsyncState } from "../../lib/useAsync";
import { profileStamp } from "./model";
import { isOutreach } from "./paths";
import { JobsWorkspaceNav } from "./WorkspaceNav";
import { jobProfileWasSuggested, markJobProfileSuggested } from "../../lib/jobsSession";

/**
 * Orbit Jobs AI's pages (/jobs/...): the tabs between them, and what they share: the search profile behind the feed,
 * the tracker, and the AI reading a first profile from the resume. Each page is its own route under this one.
 */
export interface JobsAi {
  profile: AsyncState<JobProfile>;
  tracker: AsyncState<JobTrackerEntry[]>;
  /** The AI is reading the resume into the profile. */
  suggesting: boolean;
  /** A new profile (saved, or read from a resume): every page shows it, and the feed is asked again. */
  setProfile: (profile: JobProfile) => void;
}

export function useJobsAi(): JobsAi {
  return useOutletContext<JobsAi>();
}

export function JobsAiSection() {
  const profile = useAsync(() => api.jobProfile(), [], "job-profile");
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const [suggesting, setSuggesting] = useState(false);
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const setData = profile.setData;
  const setProfile = useCallback((p: JobProfile) => setData(() => p), [setData]);

  // "Find jobs that match this resume" (Resume AI) asks for ?resume=<id>: the feed is matched to that resume, read by
  // the AI the way a first profile is. Otherwise, the first visit with a resume lets the AI read it (free, cached per
  // resume; past today's reads it's worked out from the resume as written).
  // (On Outreach, ?resume= is the resume it writes from: the feed stays matched to the profile's.)
  const wanted = isOutreach(pathname) ? null : params.get("resume");
  const ran = useRef(false);
  const p = profile.data;
  useEffect(() => {
    if (!p || ran.current || params.get("start") === "1") return;
    // Not checked against `p.resumes`: that may be the list from before the resume was made. The server checks it.
    const switchTo = wanted && wanted !== p.resume?.id ? wanted : null;
    if (wanted) {
      const next = new URLSearchParams(params);
      next.delete("resume");
      setParams(next, { replace: true });
    }
    if (!switchTo && (jobProfileWasSuggested() || p.saved || !p.resume || p.ai_left === 0)) return;
    ran.current = true;
    markJobProfileSuggested();
    setSuggesting(true);
    api
      .suggestJobProfile(switchTo ?? p.resume?.id ?? null)
      .then(setProfile)
      .catch(() => undefined) // the profile worked out from the resume stays; the Profile page can try again
      .finally(() => setSuggesting(false));
  }, [p, wanted, params, setParams, setProfile]);

  const value: JobsAi = { profile, tracker, suggesting, setProfile };
  return (
    <>
      <JobsWorkspaceNav />
      {/* Here, not the layout's: the tabs stay put while a page's code arrives. */}
      <Suspense fallback={<Skeleton variant="job-card" count={2} label="Opening Jobs AI" />}>
        <Outlet context={value} />
      </Suspense>
    </>
  );
}

export const PAGE_SIZE = 20;
const POLL_MS = 6_000;
const MAX_POLLS = 40; // about four minutes: a first refresh of every source takes one or two

/**
 * The ranked feed for this profile, search and sort, shared by the pages that show it (the overview's top matches
 * and Matches use the same first page). While a source refreshes in the background it's asked again every few
 * seconds, so new posts appear on their own.
 */
export function useJobFeed(profile: JobProfile, query = "", sort: JobSort = "best") {
  const stamp = profileStamp(profile);
  const feedKey = `${query}|${sort}|${stamp}`;
  const feed = useAsync(
    () => api.jobFeed({ q: query, sort, page_size: PAGE_SIZE }),
    [query, sort, stamp],
    `job-feed|${feedKey}`,
  );
  const [polls, setPolls] = useState(0);
  const [polledFor, setPolledFor] = useState(feedKey);
  if (polledFor !== feedKey) {
    setPolledFor(feedKey);
    setPolls(0);
  }
  const refreshing = Boolean(feed.data?.refreshing);
  const reload = feed.reload;
  useEffect(() => {
    if (!refreshing || polls >= MAX_POLLS) return;
    const t = window.setTimeout(() => {
      setPolls((n) => n + 1);
      reload();
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [refreshing, polls, reload]);
  return { feed, refreshing, key: `${query}|${sort}|${stamp}`, restartPolling: () => setPolls(0) };
}
