import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { JobFeed, JobListing, JobPortalLink, JobProfile, JobSort } from "@orbit/types";
import {
  ArrowUpRight,
  BookmarkCheck,
  Briefcase,
  FileText,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  cx,
  focusRing,
} from "@orbit/ui";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Select, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { RESUME_AI_HOME, resumePath } from "../resume/paths";
import { ResumeAiTabs } from "../resume/product";
import { JobCard } from "./JobCard";
import { ProfilePanel } from "./ProfilePanel";
import { JobTracker } from "./Tracker";
import { POSTED_WITHIN, postedAgo, profileSummary, safeUrl } from "./model";

const PAGE_SIZE = 20;
const POLL_MS = 6_000;
const MAX_POLLS = 40; // about four minutes: a first refresh of every source takes one or two

/**
 * Jobs, inside Resume AI: the latest openings that match the user's resume (from companies' own career pages and
 * remote-job boards that allow it), the profile behind the feed, "search on" links for the sites Orbit can't read,
 * and the tracker. `?view=tracker` opens the tracker.
 */
export function JobsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "tracker" ? "tracker" : "matches";
  const profile = useAsync(() => api.jobProfile(), [], "job-profile");
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");
  const [editing, setEditing] = useState(false);
  // Bumped when the profile changes: the feed is asked again.
  const [version, setVersion] = useState(0);

  const show = (v: "matches" | "tracker") => {
    const next = new URLSearchParams(params);
    if (v === "tracker") next.set("view", "tracker");
    else next.delete("view");
    setParams(next);
  };

  const saved = (p: JobProfile) => {
    profile.setData(() => p);
    setEditing(false);
    setVersion((n) => n + 1);
  };

  return (
    <>
      <ResumeAiTabs />
      <PageHeader
        icon={Briefcase}
        title="Jobs matched to your resume"
        subtitle="The latest openings from companies' own career pages and remote job boards, best match first. You apply on the original site."
      />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-zinc-200 dark:border-white/10">
        <div className="flex gap-5" role="tablist" aria-label="Jobs">
          {(
            [
              ["matches", "Matches", Sparkles],
              ["tracker", "Tracker", BookmarkCheck],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => show(id)}
              className={cx(
                "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 pb-2.5 pt-1 text-sm font-medium transition-colors",
                view === id
                  ? "border-indigo-500 text-zinc-900 dark:text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                focusRing,
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
              {id === "tracker" && tracker.data && tracker.data.length > 0 && (
                <span className="rounded-full bg-indigo-500/15 px-1.5 text-xs tabular-nums text-indigo-700 dark:text-indigo-200">{tracker.data.length}</span>
              )}
            </button>
          ))}
        </div>
        {view === "matches" && profile.data && (
          <Button variant="secondary" size="sm" className="mb-2" onClick={() => setEditing(true)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Customise
          </Button>
        )}
      </div>

      {view === "tracker" ? (
        <JobTracker tracker={tracker} />
      ) : profile.loading && !profile.data ? (
        <Spinner big label="Getting your job profile" state="searching" />
      ) : profile.error && !profile.data ? (
        <ErrorNote onRetry={profile.reload}>{errorText(profile.error)}</ErrorNote>
      ) : profile.data ? (
        <Matches
          profile={profile.data}
          version={version}
          onCustomise={() => setEditing(true)}
          onProfile={saved}
          onTracked={() => tracker.reload()}
        />
      ) : null}

      {editing && profile.data && <ProfilePanel profile={profile.data} onClose={() => setEditing(false)} onSaved={saved} />}
    </>
  );
}

// The AI fills in a first profile once per visit, when the user has a resume but hasn't saved a profile yet.
let autoSuggested = false;

function Matches({
  profile,
  version,
  onCustomise,
  onProfile,
  onTracked,
}: {
  profile: JobProfile;
  version: number;
  onCustomise: () => void;
  onProfile: (p: JobProfile) => void;
  onTracked: () => void;
}) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<JobSort>("best");
  const [polls, setPolls] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const feed = useAsync(() => api.jobFeed({ q: query, sort, page_size: PAGE_SIZE }), [query, sort, version], `job-feed|${query}|${sort}|${version}`);
  // Pages after the first, and tracker changes made on this screen (so a card doesn't wait for a reload).
  const [more, setMore] = useState<{ key: string; items: JobListing[]; page: number; hasMore: boolean } | null>(null);
  const [tracked, setTracked] = useState<Record<string, JobListing["tracked"]>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const key = `${query}|${sort}|${version}`;
  const extra = more?.key === key ? more : null;

  // First visit with a resume: let the AI read it into titles, skills and cities (free, cached per resume).
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || autoSuggested || profile.saved || !profile.resume || profile.ai_left === 0) return;
    ran.current = autoSuggested = true;
    setSuggesting(true);
    api
      .suggestJobProfile(profile.resume.id)
      .then(onProfile)
      .catch(() => undefined) // the profile worked out from the resume stays; Customise can try again
      .finally(() => setSuggesting(false));
  }, [profile, onProfile]);

  // While a source refreshes in the background, ask again every few seconds (the new posts appear on their own).
  const refreshing = Boolean(feed.data?.refreshing);
  const reloadFeed = feed.reload;
  useEffect(() => {
    if (!refreshing || polls >= MAX_POLLS) return;
    const t = window.setTimeout(() => {
      setPolls((n) => n + 1);
      reloadFeed();
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [refreshing, polls, reloadFeed]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: JobListing[] = [];
    for (const j of [...(feed.data?.items ?? []), ...(extra?.items ?? [])]) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      out.push(j.id in tracked ? { ...j, tracked: tracked[j.id] ?? null } : j);
    }
    return out;
  }, [feed.data, extra, tracked]);

  const loadMore = async () => {
    const page = (extra?.page ?? 1) + 1;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await api.jobFeed({ q: query, sort, page, page_size: PAGE_SIZE });
      setMore({ key, items: [...(extra?.items ?? []), ...next.items], page, hasMore: next.has_more });
    } catch (err) {
      setMoreError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(text.trim());
    setPolls(0);
  };
  const clear = () => {
    setText("");
    setQuery("");
  };

  const data = feed.data;
  const hasMore = extra ? extra.hasMore : Boolean(data?.has_more);
  const days = POSTED_WITHIN.find((p) => p.days === profile.prefs.posted_within) ?? POSTED_WITHIN[2]!;

  return (
    // minmax(0, 1fr): on a phone the one column is the screen's width, not its widest child's (the portal strip).
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-4">
        <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row" role="search">
          <label htmlFor="job-q" className="sr-only">
            Search your matches
          </label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input
              id="job-q"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              placeholder="Try: remote React jobs in Bangalore, 2 years"
              className={cx(
                "block w-full rounded-xl border border-zinc-200 bg-white/90 py-2.5 pl-9 pr-9 text-sm placeholder:text-zinc-400 hover:border-zinc-300 focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-950/60 dark:placeholder:text-zinc-500",
                focusRing,
              )}
            />
            {text && (
              <button type="button" onClick={clear} aria-label="Clear the search" className={cx("absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-white", focusRing)}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1 sm:flex-none">
              Search
            </Button>
            <label htmlFor="job-sort" className="sr-only">
              Sort
            </label>
            <Select id="job-sort" value={sort} onChange={(e) => setSort(e.target.value as JobSort)} className="!w-auto">
              <option value="best">Best match</option>
              <option value="newest">Newest</option>
            </Select>
          </div>
        </form>

        {/* Phones: the profile in a line (the full card and the portal links sit beside the feed on wide screens). */}
        <p className="text-xs text-zinc-500 dark:text-zinc-400 lg:hidden">
          <span className="font-medium text-zinc-700 dark:text-zinc-200">Looking for:</span> {profileSummary(profile.prefs)}
          {suggesting && " · the AI is reading your resume…"}
        </p>

        {query && data && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Showing
            {data.understood.map((u) => (
              <span key={u} className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium text-indigo-700 dark:text-indigo-200">
                {u}
              </span>
            ))}
            {data.keywords && <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 font-medium text-zinc-700 dark:text-zinc-200">“{data.keywords}”</span>}
            <button type="button" onClick={clear} className={cx("ml-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
              Back to all matches
            </button>
          </p>
        )}

        {data && data.total > 0 && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300" aria-live="polite">
            <span>
              <strong className="font-semibold tabular-nums">{data.total}</strong> {data.total === 1 ? "match" : "matches"} posted in the {days.label.toLowerCase()}
              {sort === "best" ? ", best first" : ", newest first"}
            </span>
            {(refreshing || suggesting) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-200">
                <RefreshCw className="h-3 w-3 motion-safe:animate-spin" aria-hidden /> {suggesting ? "Reading your resume" : "Checking for new jobs"}
              </span>
            )}
          </p>
        )}

        {!profile.resume && (
          <Card className="flex flex-wrap items-center gap-3">
            <FileText className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
            <p className="min-w-0 flex-1 text-sm">
              <strong className="font-medium">Make a resume to see your matches.</strong> Orbit reads your titles, skills and experience from it. Until then
              these are the newest jobs.
            </p>
            <Link to={RESUME_AI_HOME} className={cx("rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500", focusRing)}>
              Open Resume AI
            </Link>
          </Card>
        )}

        {feed.loading && !data ? (
          <Spinner big label={suggesting ? "Reading your resume" : "Finding jobs that match your resume"} state="searching" />
        ) : feed.error && !data ? (
          <div className="space-y-4">
            <ErrorNote onRetry={feed.reload}>{errorText(feed.error)}</ErrorNote>
            <PortalCard portals={null} days={days.short} prominent />
          </div>
        ) : data && data.total === 0 ? (
          <NoMatches feed={data} days={days.label} onCustomise={onCustomise} searching={Boolean(query)} />
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((job) => (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    resumeId={profile.resume?.id ?? null}
                    onTracked={(id, t) => {
                      setTracked((prev) => ({ ...prev, [id]: t }));
                      onTracked();
                    }}
                  />
                </li>
              ))}
            </ul>
            {moreError && <ErrorNote onRetry={() => void loadMore()}>{moreError}</ErrorNote>}
            {hasMore && (
              <div className="flex justify-center">
                <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "Loading…" : "Show more jobs"}
                </Button>
              </div>
            )}
            <div className="lg:hidden">
              <PortalCard portals={data?.portals ?? null} days={days.short} />
            </div>
            {data && <SourcesNote feed={data} />}
          </>
        )}
      </div>

      <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block lg:self-start" aria-label="Your job profile">
        <ProfileCard profile={profile} suggesting={suggesting} onCustomise={onCustomise} />
        <PortalCard portals={data?.portals ?? null} days={days.short} />
      </aside>
    </div>
  );
}

function ProfileCard({ profile, suggesting, onCustomise }: { profile: JobProfile; suggesting: boolean; onCustomise: () => void }) {
  const p = profile.prefs;
  return (
    <Card className="!p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold">Looking for</h2>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-200">{profileSummary(p)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCustomise} aria-label="Customise your feed">
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          <span className="lg:hidden">Customise</span>
        </Button>
      </div>
      {p.skills.length > 0 && (
        <ul className="mt-3 hidden flex-wrap gap-1 sm:flex" aria-label="Your key skills">
          {p.skills.slice(0, 10).map((s) => (
            <li key={s} className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs text-zinc-700 dark:text-zinc-300">
              {s}
            </li>
          ))}
          {p.skills.length > 10 && <li className="px-1 py-0.5 text-xs text-zinc-500">+{p.skills.length - 10}</li>}
        </ul>
      )}
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {suggesting ? (
          "The AI is reading your resume…"
        ) : profile.resume ? (
          <>
            Matched to{" "}
            <Link to={resumePath(profile.resume.id)} className={cx("font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
              {profile.resume.title}
            </Link>
            {profile.suggested?.by === "ai" ? ", read by the AI." : "."}
          </>
        ) : (
          "No resume yet."
        )}
      </p>
    </Card>
  );
}

/** "Search on LinkedIn / Naukri / …": their own searches, filled in from the profile. No data is read from them. */
function PortalCard({ portals, days, prominent = false }: { portals: JobPortalLink[] | null; days: string; prominent?: boolean }) {
  if (!portals?.length) {
    return prominent ? (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">You can still search LinkedIn, Naukri and Indeed directly while Orbit can't reach the job boards.</p>
    ) : null;
  }
  return (
    <Card className={cx("!p-4", prominent && "gradient-border")}>
      <h2 className="font-display text-sm font-semibold">Search on other sites</h2>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Their own search, filled in from your profile · last {days}.</p>
      <ul className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {portals.map((p) => {
          const url = safeUrl(p.url);
          return url ? (
            <li key={p.id} className="shrink-0">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cx(
                  "inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-sm font-medium text-zinc-700 hover:border-indigo-400 hover:text-indigo-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:text-white",
                  focusRing,
                )}
              >
                {p.name} <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
              </a>
            </li>
          ) : null;
        })}
      </ul>
    </Card>
  );
}

function NoMatches({ feed, days, onCustomise, searching }: { feed: JobFeed; days: string; onCustomise: () => void; searching: boolean }) {
  const down = feed.sources.length > 0 && feed.sources.every((s) => s.failing || (s.listings === 0 && !s.refreshing));
  const first = feed.refreshing && feed.sources.every((s) => s.listings === 0);
  return (
    <div className="space-y-4">
      {first ? (
        <Card className="text-center">
          <Spinner big label="Fetching the latest jobs from company career pages and remote boards" state="searching" />
          <p className="-mt-6 pb-4 text-sm text-zinc-500 dark:text-zinc-400">The first time takes a minute or two. They appear here by themselves.</p>
        </Card>
      ) : down ? (
        <EmptyState
          icon={Briefcase}
          title="Orbit can't reach the job boards right now"
          body="They're usually back within the hour. Meanwhile, search the sites below: the links are filled in from your profile."
        />
      ) : (
        <EmptyState
          icon={Search}
          title={searching ? "Nothing matches that search" : `No matches posted in the ${days.toLowerCase()}`}
          body={
            searching
              ? "Try fewer words, or another city. The search looks within your matches."
              : "Try a longer time range, more job titles or cities, or turn on remote. New jobs come in through the day."
          }
          action={
            <Button variant="secondary" onClick={onCustomise}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Customise your feed
            </Button>
          }
        />
      )}
      <PortalCard portals={feed.portals} days={days.replace(/^Last /, "").toLowerCase()} prominent />
    </div>
  );
}

/** Where the jobs come from, with the credit each feed asks for, and how fresh they are. */
function SourcesNote({ feed }: { feed: JobFeed }) {
  const boards = feed.sources.filter((s) => s.kind === "board").map((s) => s.label);
  const latest = feed.sources.map((s) => s.last_success_at).filter((t): t is string => Boolean(t)).sort().pop();
  return (
    <p className="pt-2 text-xs text-zinc-500 dark:text-zinc-400">
      Jobs come from companies' own career pages{boards.length ? ` (${boards.join(", ")})` : ""} and remote-job boards{" "}
      {feed.sources
        .filter((s) => s.kind !== "board")
        .map((s, i, all) => (
          <span key={s.id}>
            {s.label}
            {i < all.length - 2 ? ", " : i === all.length - 2 ? " and " : ""}
          </span>
        ))}
      . Each links to the original post. {latest && `Updated ${postedAgo(latest).toLowerCase()}.`}
    </p>
  );
}
