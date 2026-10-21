import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { JobFeed, JobListing, JobPortalLink, JobPrefs, JobProfile, JobSort } from "@orbit/types";
import {
  ArrowUpRight,
  FileText,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
  CosmicEmptyState,
  LoadGate,
  WorkingState,
  cx,
  isIndia,
  focusRing,
  regionWords,
  sampleCity,
} from "@orbit/ui";
import { KashSecContext } from "../../components/KashSec";
import { Button, Card, ErrorNote, PageHeader, Select } from "../../components/ui";
import { isSecurityRole } from "../../lib/security";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useCountry } from "../../lib/country";
import { RESUME_AI_HOME, resumePath } from "../resume/paths";
import { JobCard } from "./JobCard";
import { PAGE_SIZE, useJobFeed, useJobsAi } from "./JobsAi";
import { linkButton, textLink } from "./links";
import {
  POSTED_WITHIN,
  WORKPLACES,
  activeFilterCount,
  hasQueryWord,
  matchBasis,
  postedAgo,
  profileSummary,
  safeUrl,
  toggleQueryWord,
  toggleWorkplace,
  withTracked,
  ANYWHERE_TOKENS,
} from "./model";
import { getShownMore, setShownMore } from "../../lib/jobsSession";
import { JOBS_PROFILE } from "./paths";
import { Sheet } from "./Sheet";
import { MoreTools } from "../tools/MoreTools";

/**
 * Jobs → Matches: the latest openings that match the user's resume (from companies' own career pages and
 * remote-job boards that allow it), best first, with the search box, sort and quick filters, and "search on" links
 * for the sites Orbit can't read. `?q=` and `?sort=` keep the search in the address, so Back returns to it.
 */
export function JobMatchesPage() {
  const { profile } = useJobsAi();
  return (
    <>
      <PageHeader
        icon={Search}
        title="Discover opportunities"
        subtitle="From companies' own career pages and remote job boards. You apply on the original site."
        actions={
          profile.data && (
            // Phones have "More filters" beside the quick filters, a little further down.
            <Link to={JOBS_PROFILE} className={cx(linkButton("secondary"), "hidden sm:inline-flex")}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Customise
            </Link>
          )
        }
      />
      <LoadGate loading={profile.loading && !profile.data} variant="job-card" count={3} label="Getting your job profile">
      {profile.error && !profile.data ? (
        <ErrorNote onRetry={profile.reload}>{errorText(profile.error)}</ErrorNote>
      ) : profile.data ? (
        <Matches profile={profile.data} />
      ) : null}
      </LoadGate>
      <div className="mt-10"><MoreTools home="jobs" shown={["/jobs/matches"]} title="Jobs tools" /></div>
    </>
  );
}

function Matches({ profile }: { profile: JobProfile }) {
  const country = useCountry();
  const { tracker, suggesting, setProfile } = useJobsAi();
  const [params, setParams] = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  // With nothing to match against (no resume, no skills), "best match" means nothing: newest first.
  const basis = matchBasis(profile);
  const defaultSort: JobSort = basis ? "best" : "newest";
  const asked = params.get("sort");
  const sort: JobSort = asked === "newest" || asked === "best" ? asked : defaultSort;
  const [text, setText] = useState(query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { feed, refreshing, key, restartPolling } = useJobFeed(profile, query, sort);
  // Pages after the first, and tracker changes made on this screen (so a card doesn't wait for a reload).
  const [more, setMore] = useState(getShownMore);
  const [changed, setChanged] = useState<Record<string, JobListing["tracked"]>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const extra = more?.key === key ? more : null;

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: JobListing[] = [];
    for (const j of [...(feed.data?.items ?? []), ...(extra?.items ?? [])]) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      out.push(j);
    }
    return withTracked(out, changed, tracker.data);
  }, [feed.data, extra, changed, tracker.data]);

  const loadMore = async () => {
    const page = (extra?.page ?? 1) + 1;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await api.jobFeed({ q: query, sort, page, page_size: PAGE_SIZE });
      const nextMore = { key, items: [...(extra?.items ?? []), ...next.items], page, hasMore: next.has_more };
      setShownMore(nextMore);
      setMore(nextMore);
    } catch (err) {
      setMoreError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const setSearch = (q: string, s: JobSort = sort) => {
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    if (s !== defaultSort) next.set("sort", s);
    else next.delete("sort");
    setParams(next, { replace: true });
    restartPolling();
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    setSearch(text.trim());
  };
  const clear = () => {
    setText("");
    setSearch("");
  };
  /** The quick chips: words the search box understands ("fresher", "internship"), added to or taken out of it. */
  const toggleWord = (word: string) => {
    const q = toggleQueryWord(query, word);
    setText(q);
    setSearch(q);
  };
  const filters = activeFilterCount(profile.prefs, query, sort, defaultSort);

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
          {/* Phones: the box and "Filters · 2" in one row (Enter searches); the filters open in a sheet. */}
          <div className="flex min-w-0 flex-1 gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input
              id="job-q"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              enterKeyHint="search"
              placeholder={`Try: remote React jobs in ${profile.cities.find((c) => !ANYWHERE_TOKENS.includes(c)) ?? (isIndia(country) ? "Bangalore" : (sampleCity(country) ?? "your city"))}, 2 years`}
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
            <Button variant="secondary" className="shrink-0 sm:hidden" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters
              {filters > 0 && (
                <span className="rounded-full bg-indigo-500/15 px-1.5 text-xs tabular-nums text-indigo-700 dark:text-indigo-200">
                  <span className="sr-only">, </span>
                  {filters}
                  <span className="sr-only"> on</span>
                </span>
              )}
            </Button>
          </div>
          <div className="hidden gap-2 sm:flex">
            <Button type="submit" className="flex-1 sm:flex-none">
              Search
            </Button>
            <label htmlFor="job-sort" className="sr-only">
              Sort
            </label>
            <Select id="job-sort" value={sort} onChange={(e) => setSearch(query, e.target.value as JobSort)} className="!w-auto">
              <option value="best">Best match</option>
              <option value="newest">Newest</option>
            </Select>
          </div>
        </form>

        <div className="hidden sm:block">
          <QuickFilters profile={profile} disabled={suggesting} onSaved={setProfile} words={<WordChips query={query} onToggle={toggleWord} />} />
        </div>
        <WordChips query={query} onToggle={toggleWord} className="edge-fade-x -mx-4 overflow-x-auto px-4 sm:hidden" />
        <Sheet
          open={filtersOpen}
          title="Filters"
          onClose={() => setFiltersOpen(false)}
          footer={
            <Button className="w-full" onClick={() => setFiltersOpen(false)}>
              {data ? `Show ${data.total} ${data.total === 1 ? "job" : "jobs"}` : "Show jobs"}
            </Button>
          }
        >
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Sort</legend>
              <div role="group" aria-label="Sort" className="inline-flex gap-0.5 rounded-xl bg-zinc-500/10 p-1">
                {(["best", "newest"] as const).map((s) => (
                  <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSearch(query, s)} className={chipClass(sort === s, "px-3 py-1.5 text-sm")}>
                    {s === "best" ? "Best match" : "Newest"}
                  </button>
                ))}
              </div>
            </fieldset>
            <QuickFilters profile={profile} disabled={suggesting} onSaved={setProfile} layout="sheet" words={<WordChips query={query} onToggle={toggleWord} big />} />
          </div>
        </Sheet>

        {/* Phones: the profile in a line (the full card and the portal links sit beside the feed on wide screens). */}
        <p className="text-xs text-zinc-500 dark:text-zinc-400 lg:hidden">
          <span className="font-medium text-zinc-700 dark:text-zinc-200">Looking for:</span> {profileSummary(profile.prefs, country)}
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
              <strong className="font-semibold tabular-nums">{data.total}</strong> {basis ? (data.total === 1 ? "match" : "matches") : data.total === 1 ? "job" : "jobs"} posted
              in the {days.label.toLowerCase()}
              {sort === "best" ? ", best first" : ", newest first"}
            </span>
            <Busy refreshing={refreshing} suggesting={suggesting} />
          </p>
        )}

        {!basis && <NoResume blank={Boolean(profile.resume)} />}
        {isSecurityRole(...profile.prefs.titles) && <KashSecContext placement="matches" />}

        {feed.loading && !data ? (
          <WorkingState kind={suggesting ? "reading" : "matching"} label={suggesting ? "Reading your resume" : "Finding jobs that match your resume"} />
        ) : feed.error && !data ? (
          <div className="space-y-4">
            <ErrorNote onRetry={feed.reload}>{errorText(feed.error)}</ErrorNote>
            <PortalCard portals={null} days={days.short} prominent />
          </div>
        ) : data && data.total === 0 ? (
          <NoMatches feed={data} days={days.label} searching={Boolean(query)} />
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((job) => (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    showMatch={basis !== null}
                    resumeId={profile.resume?.id ?? null}
                    onTracked={(id, t) => {
                      setChanged((prev) => ({ ...prev, [id]: t }));
                      tracker.reload();
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
        <ProfileCard profile={profile} suggesting={suggesting} />
        {/* With no matches the list already shows these links up front; don't repeat them here. */}
        {data && data.total > 0 && <PortalCard portals={data.portals} days={days.short} />}
      </aside>
    </div>
  );
}

/** "Checking for new jobs" while a source refreshes; "Reading your resume" while the AI fills in the profile. */
export function Busy({ refreshing, suggesting }: { refreshing: boolean; suggesting: boolean }) {
  if (!refreshing && !suggesting) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-200">
      <RefreshCw className="h-3 w-3 motion-safe:animate-spin" aria-hidden /> {suggesting ? "Reading your resume" : "Checking for new jobs"}
    </span>
  );
}

/** A segmented-control chip, on or off. */
function chipClass(on: boolean, size = "px-2.5 py-1 text-xs"): string {
  return cx(
    "whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
    size,
    on ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
    focusRing,
  );
}

/**
 * "Fresher" and "Internship": words the search box already understands (fresher-level posts; internships), toggled in
 * the search rather than saved to the profile, so they're as quick to take off as to put on. Outside India the first is
 * "Entry level" (the word "entry-level", which the search reads as the same level).
 */
function WordChips({ query, onToggle, big = false, className }: { query: string; onToggle: (word: string) => void; big?: boolean; className?: string }) {
  const words = regionWords(useCountry());
  return (
    <div role="group" aria-label={words.earlyCareer} className={cx("flex shrink-0 gap-1.5", className)}>
      {[
        [words.entryLevelQuery, words.entryLevel],
        ["internship", "Internship"],
      ].map(([word, label]) => {
        const on = hasQueryWord(query, word!);
        return (
          <button
            key={word}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(word!)}
            className={cx(
              "shrink-0 whitespace-nowrap rounded-full border font-medium",
              big ? "px-3.5 py-1.5 text-sm" : "px-3 py-1 text-xs",
              on ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200" : "border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300",
              focusRing,
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The two filters people change most, a tap away: how recent, and the work mode. Each saves the profile (the feed is
 * worked out from it); everything else is on the Profile page. `layout="sheet"`: labelled, one per row, for the phone's
 * Filters sheet. `words`: the fresher chips, beside them.
 */
function QuickFilters({
  profile,
  disabled,
  onSaved,
  layout = "row",
  words,
}: {
  profile: JobProfile;
  disabled: boolean;
  onSaved: (p: JobProfile) => void;
  layout?: "row" | "sheet";
  words?: React.ReactNode;
}) {
  const country = useCountry();
  // Shown at once while it saves; the feed waits for the saved profile, so it never ranks with the old one.
  const [pending, setPending] = useState<JobPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefs = pending ?? profile.prefs;
  const save = async (next: JobPrefs) => {
    setPending(next);
    setError(null);
    try {
      onSaved(await api.saveJobProfile(next, profile.resume?.id ?? null));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  };
  const off = disabled || pending !== null;
  const sheet = layout === "sheet";
  const chip = (on: boolean) => chipClass(on, sheet ? "px-3 py-1.5 text-sm" : undefined);
  const recent = (
    <div role="group" aria-label="Posted within" className="inline-flex shrink-0 gap-0.5 rounded-xl bg-zinc-500/10 p-1">
      {POSTED_WITHIN.map((p) => (
        <button
          key={p.days}
          type="button"
          disabled={off}
          aria-pressed={prefs.posted_within === p.days}
          title={p.label}
          onClick={() => void save({ ...prefs, posted_within: p.days })}
          className={chip(prefs.posted_within === p.days)}
        >
          {p.short}
        </button>
      ))}
    </div>
  );
  const modes = (
    <div role="group" aria-label="Work mode" className="inline-flex shrink-0 gap-0.5 rounded-xl bg-zinc-500/10 p-1">
      {WORKPLACES.map((w) => (
        <button
          key={w.id}
          type="button"
          disabled={off}
          aria-pressed={prefs.workplace.includes(w.id)}
          onClick={() => void save({ ...prefs, workplace: toggleWorkplace(prefs.workplace, w.id) })}
          className={chip(prefs.workplace.includes(w.id))}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
  if (sheet) {
    return (
      <>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Posted in the last</legend>
          {recent}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Work mode</legend>
          {modes}
        </fieldset>
        {words && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{regionWords(country).earlyCareer}</legend>
            {words}
          </fieldset>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Link to={JOBS_PROFILE} className={cx(textLink, "inline-flex items-center gap-1.5 text-sm")}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> Titles, cities, job types and more
        </Link>
      </>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {recent}
        {modes}
        {words}
        <Link to={JOBS_PROFILE} className={cx("inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-300", focusRing)}>
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> More filters
        </Link>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

/**
 * Nothing to match against yet (model.ts `matchBasis`): no resume, or (`blank`) one with no title or skills in it.
 * Until then the feed is the newest jobs, with no match score.
 */
export function NoResume({ blank = false }: { blank?: boolean }) {
  return (
    <Card className="flex flex-wrap items-center gap-3">
      <FileText className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        {blank ? (
          <>
            <strong className="font-medium">Add your skills to see how you match.</strong> Your resume doesn't list a job title or skills yet: add them in
            Resume, or type your skills into your profile. Until then these are the newest jobs, with no match score.
          </>
        ) : (
          <>
            <strong className="font-medium">Add your resume to see how you match.</strong> Orbit reads your titles, skills and experience from it. Until then
            these are the newest jobs, with no match score.
          </>
        )}
      </p>
      {/* Its own line on a phone, so the words get the card's full width. */}
      <Link to={RESUME_AI_HOME} className={cx(linkButton("primary", "sm"), "w-full sm:w-auto")}>
        {blank ? "Open Resume" : "Add your resume"}
      </Link>
    </Card>
  );
}

/** What the feed looks for, the skills it matches on, and the resume it reads, with the way to change them. */
export function ProfileCard({ profile, suggesting, className }: { profile: JobProfile; suggesting: boolean; className?: string }) {
  const country = useCountry();
  const p = profile.prefs;
  return (
    <Card className={cx("!p-4", className)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold">Looking for</h2>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-200">{profileSummary(p, country)}</p>
        </div>
        <Link to={JOBS_PROFILE} className={linkButton("ghost", "sm")} aria-label="Edit your search profile" title="Edit your search profile">
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      {p.skills.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1" aria-label="Your key skills">
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
            <Link to={resumePath(profile.resume.id)} className={textLink}>
              {profile.resume.title}
            </Link>{" "}
            in Resume{profile.suggested?.by === "ai" ? ", read by the AI." : "."}
          </>
        ) : (
          "No resume yet."
        )}
      </p>
    </Card>
  );
}

/** "Search on LinkedIn / Naukri / …": their own searches, filled in from the profile. No data is read from them. */
export function PortalCard({ portals, days, prominent = false }: { portals: JobPortalLink[] | null; days: string; prominent?: boolean }) {
  const india = isIndia(useCountry());
  if (!portals?.length) {
    return prominent ? (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        You can still search {india ? "LinkedIn, Naukri and Indeed" : "LinkedIn and Indeed"} directly while Orbit can't reach the job boards.
      </p>
    ) : null;
  }
  return (
    <Card className={cx("!p-4", prominent && "gradient-border")}>
      <h2 className="font-display text-sm font-semibold">Search on other sites</h2>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Their own search, filled in from your profile · last {days}.</p>
      <ul className="edge-fade-x -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
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

function NoMatches({ feed, days, searching }: { feed: JobFeed; days: string; searching: boolean }) {
  // "Can't reach" only when the boards are failing: every board answering with nothing yet isn't an outage (it read as
  // one whenever the feed was simply empty).
  const down = feed.sources.length > 0 && feed.sources.every((s) => s.failing);
  const empty = !down && feed.sources.length > 0 && feed.sources.every((s) => s.failing || (s.listings === 0 && !s.refreshing));
  return (
    <div className="space-y-4">
      {firstFetch(feed) ? (
        <FirstFetch />
      ) : down ? (
        <CosmicEmptyState
          variant="offline"
          title="Orbit can't reach the job boards right now"
          body="They're usually back within the hour. Meanwhile, search the sites below: the links are filled in from your profile."
        />
      ) : empty ? (
        <CosmicEmptyState
          variant="no-results"
          title="No jobs from the boards yet"
          body="The job boards Orbit reads haven't sent any posts yet; they're checked again through the day. Meanwhile, search the sites below: the links are filled in from your profile."
        />
      ) : (
        <CosmicEmptyState
          variant="no-results"
          kind="no-results"
          title={searching ? "Nothing matches that search" : `No matches posted in the ${days.toLowerCase()}`}
          body={
            searching
              ? "Try fewer words, or another city. The search looks within your matches."
              : "Try a longer time range, more job titles or cities, or turn on remote. New jobs come in through the day."
          }
          action={
            <Link to={JOBS_PROFILE} className={linkButton("secondary")}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Customise your feed
            </Link>
          }
        />
      )}
      <PortalCard portals={feed.portals} days={days.replace(/^Last /, "").toLowerCase()} prominent />
    </div>
  );
}

/** The very first refresh of every source: nothing cached yet, posts on their way. */
export function firstFetch(feed: JobFeed): boolean {
  return feed.refreshing && feed.sources.every((s) => s.listings === 0);
}

export function FirstFetch() {
  return (
    <Card className="text-center">
      <WorkingState kind="matching" label="Fetching the latest jobs from company career pages and remote boards" />
      <p className="-mt-6 pb-4 text-sm text-zinc-500 dark:text-zinc-400">The first time takes a minute or two. They appear here by themselves.</p>
    </Card>
  );
}

/** Where the jobs come from, with the credit each feed asks for, and how fresh they are. */
export function SourcesNote({ feed }: { feed: JobFeed }) {
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
