import { useEffect, useState } from "react";
import { cx, focusRing } from "@orbit/ui";
import { API_URL } from "./api";
import { checkUpdate, installUpdate, type UpdateInfo, type UpdateProgress } from "./native";

/**
 * Shown only on the setup screen — never during a live session (the Rust side also refuses to install
 * while audio capture is running). Check failures are silent: an offline check shouldn't nag.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkUpdate(API_URL)
      .then((u) => !cancelled && setUpdate(u))
      .catch((err: unknown) => console.info("Update check skipped:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  const install = () => {
    setError(null);
    setProgress({ kind: "downloading", downloaded: 0, total: null });
    installUpdate(setProgress).catch((err: unknown) => {
      console.warn("Update install failed:", err);
      setProgress(null);
      const text = String(err);
      setError(
        /live session|Microsoft Store/i.test(text)
          ? text
          : "The update didn't install. Check your connection and try again in a minute.",
      );
    });
  };

  const pct =
    progress?.kind === "downloading" && progress.total ? Math.round((progress.downloaded / progress.total) * 100) : null;

  return (
    <div role="status" className="border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-200">
      <div className="flex items-center gap-2">
        <span className="flex-1">
          {progress?.kind === "installing"
            ? "Installing — Orbit will restart…"
            : progress
              ? `Downloading Orbit ${update.version}${pct !== null ? ` · ${pct}%` : "…"}`
              : `Orbit ${update.version} is available.`}
        </span>
        {!progress && (
          <button type="button" onClick={install} className={cx("rounded bg-indigo-600 px-2 py-0.5 font-medium text-white hover:bg-indigo-500", focusRing)}>
            Update &amp; restart
          </button>
        )}
      </div>
      {update.notes && !progress && <p className="mt-1 line-clamp-2 text-indigo-800/80 dark:text-indigo-300/80">{update.notes}</p>}
      {error && <p className="mt-1 text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
