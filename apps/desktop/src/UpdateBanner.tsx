import { Download, cx, focusRing } from "@orbit/ui";
import { installNow, postponeUpdate, startUpdate, useUpdate } from "./updates";

const button = cx("shrink-0 rounded bg-indigo-600 px-2 py-0.5 font-medium text-white hover:bg-indigo-500", focusRing);
const link = cx("shrink-0 font-medium underline", focusRing);

/**
 * The update offer and its progress (state in updates.ts; App checks for updates). Shown on the home and setup
 * screens — never during a live session; installing (which restarts Orbit) is also refused while audio is being
 * captured. Every other screen has the title bar's UpdatePill.
 */
export function UpdateBanner() {
  const update = useUpdate();

  const { phase, info } = update;
  if (phase === "idle" || !info) return null;
  const pct = update.total ? Math.round((update.downloaded / update.total) * 100) : null;

  return (
    <div role="status" className="border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-200">
      <div className="flex items-center gap-2">
        <span className="flex-1">
          {phase === "installing"
            ? "Installing — Orbit will restart…"
            : phase === "ready"
              ? `Orbit ${info.version} is ready. Restarting closes Orbit for a moment.`
              : phase === "downloading"
                ? update.verifying
                  ? `Checking Orbit ${info.version}…`
                  : `Downloading Orbit ${info.version}${pct !== null ? ` · ${pct}%` : "…"}${
                      update.installWhenReady ? " — Orbit restarts when it's done." : " — it installs when you restart."
                    }`
                : `Orbit ${info.version} is available.`}
        </span>
        {phase === "available" && (
          <button type="button" onClick={startUpdate} className={button}>
            Update &amp; restart
          </button>
        )}
        {phase === "downloading" && update.installWhenReady && (
          <button type="button" onClick={postponeUpdate} title="Keep downloading, and install after your session" className={link}>
            Not now
          </button>
        )}
        {phase === "ready" && (
          <button type="button" onClick={installNow} className={button}>
            Restart to update
          </button>
        )}
      </div>
      {info.notes && phase === "available" && <p className="mt-1 line-clamp-2 text-indigo-800/80 dark:text-indigo-300/80">{info.notes}</p>}
      {update.error && <p className="mt-1 text-rose-700 dark:text-rose-300">{update.error}</p>}
    </div>
  );
}

const pill = "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium";
const pillButton = cx(pill, "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500", focusRing);
const pillStatus = cx(pill, "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200");

/** The update in the title bar of every screen (Live has none): Orbit shows a new version wherever the user is. */
export function UpdatePill() {
  const update = useUpdate();
  const { phase, info } = update;
  if (phase === "idle" || !info) return null;
  if (phase === "available") {
    return (
      <button
        type="button"
        onClick={startUpdate}
        title={`Orbit ${info.version} is available (you have ${info.currentVersion}). Update and restart.${update.error ? ` ${update.error}` : ""}`}
        className={pillButton}
      >
        <Download className="h-3.5 w-3.5" />
        Update to {info.version}
      </button>
    );
  }
  if (phase === "ready") {
    return (
      <button type="button" onClick={installNow} title={update.error ?? `Install Orbit ${info.version}`} className={pillButton}>
        <Download className="h-3.5 w-3.5" />
        Restart to update
      </button>
    );
  }
  const pct = update.total ? Math.round((update.downloaded / update.total) * 100) : null;
  return (
    <span role="status" className={pillStatus}>
      {phase === "installing" ? "Restarting…" : `Updating${pct !== null ? ` · ${pct}%` : "…"}`}
    </span>
  );
}
