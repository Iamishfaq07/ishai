import { useEffect, useState } from "react";
import { buttonClass } from "@orbit/ui";
import { isStaleBuildError, reloadForNewBuild } from "../lib/staleBuild";

/**
 * What shows when a page fails to draw. The common case after a deploy (the page's file is from the build before)
 * reloads once by itself and, if that was just tried, says what happened in plain words instead of the browser's.
 */
export function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const stale = isStaleBuildError(error);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    if (stale && reloadForNewBuild()) setReloading(true);
  }, [stale]);
  return (
    <div role="alert" className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {stale ? "Orbit has just been updated" : "Something went wrong"}
      </p>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        {stale
          ? reloading
            ? "Loading the new version…"
            : "This page is from the version before. Reload to get the new one: nothing you've saved is lost."
          : "This part of the page hit a problem and couldn't be shown. Try again, or reload: nothing you've saved is lost."}
      </p>
      {/* The technical words, for a support message (never the headline: "x.filter is not a function" means nothing). */}
      {!stale && error.message && (
        <details className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          <summary className="cursor-pointer">Details for support</summary>
          <p className="mt-1 break-words font-mono">{error.message.slice(0, 300)}</p>
        </details>
      )}
      {!reloading && (
        <div className="flex gap-2">
          {!stale && (
            <button type="button" onClick={reset} className={buttonClass("secondary")}>
              Try again
            </button>
          )}
          <button type="button" onClick={() => window.location.reload()}
                  className={buttonClass("primary")}>
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
