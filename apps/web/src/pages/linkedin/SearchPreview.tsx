import { useState } from "react";
import type { LinkedInRead } from "@orbit/types";
import { Briefcase, MapPin, Search, SegmentedControl, cx } from "@orbit/ui";
import { Card } from "../../components/ui";
import { ABOUT_SHOWN, HEADLINE_SHOWN, aboutPreview, searchPreview } from "./model";

type View = "copy" | "read";

/**
 * How a recruiter's search shows the profile: a plain Orbit mock of a search result (not LinkedIn's own look), with
 * the headline cut where a result cuts it, the place and the current role, then the About as far as it goes before
 * "see more". It shows Orbit's copy, so an applied fix shows here at once; "As on LinkedIn" shows what was read.
 */
export function SearchPreview({ profile, read, query }: { profile: LinkedInRead; read: LinkedInRead | null; query: string }) {
  const differs = Boolean(read) && (read!.headline !== profile.headline || read!.about !== profile.about || read!.location !== profile.location);
  const [view, setView] = useState<View>("copy");
  const shown = view === "read" && read ? read : profile;
  const r = searchPreview(shown);
  const about = aboutPreview(shown.about);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold">How a recruiter's search shows you</h2>
        {differs && (
          <SegmentedControl<View>
            size="sm"
            label="Which version"
            value={view}
            onChange={setView}
            options={[{ value: "copy", label: "With your fixes" }, { value: "read", label: "As on LinkedIn" }]}
          />
        )}
      </div>
      <figure aria-label="A preview of your profile in a search result" className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-950">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{query || "The role you want"}</span>
          <span className="ml-auto shrink-0 text-xs">People</span>
        </div>
        <div className="flex gap-3 p-4">
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-sm font-semibold text-indigo-800 ring-1 ring-inset ring-indigo-500/25 dark:text-indigo-200">
            {r.initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">{r.name}</p>
            <p className={cx("text-sm text-zinc-700 dark:text-zinc-200", !shown.headline && "italic text-zinc-500")}>
              {shown.headline ? <>{r.headline}{r.cut && <><span aria-hidden>…</span><span className="sr-only"> (cut off here)</span></>}</> : "No headline yet"}
            </p>
            {r.location && (
              <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> {r.location}
              </p>
            )}
            {r.current && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden /> Current: {r.current}
              </p>
            )}
          </div>
        </div>
        <div className="border-t border-zinc-200 px-4 py-3 dark:border-white/10">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">About</p>
          <p className={cx("mt-1 text-sm text-zinc-700 dark:text-zinc-200", !shown.about && "italic text-zinc-500")}>
            {shown.about ? (
              <>
                {about.shown}
                {about.cut && <span className="font-medium text-indigo-700 dark:text-indigo-300">… see more</span>}
              </>
            ) : (
              "No About yet: this space is empty on your profile."
            )}
          </p>
        </div>
      </figure>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        A preview drawn by Orbit, not LinkedIn's own page. Search results show about the first {HEADLINE_SHOWN} characters of a headline on a phone, and About about {ABOUT_SHOWN} before "see more": put your role and best result there.
      </p>
    </Card>
  );
}
