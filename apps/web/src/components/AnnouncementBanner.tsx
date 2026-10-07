import { useEffect, useState } from "react";
import type { Announcement } from "@orbit/types";
import { Megaphone, X, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { announcementVisible } from "../pages/admin/logic";

const DISMISSED_KEY = "orbit.announcement.dismissed";
const REFRESH_MS = 5 * 60_000;

function dismissedId(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * The site-wide announcement the admin set (Users & access → Site announcement), above every signed-in page. Dismissed
 * once per text: a new announcement shows again. Re-read every few minutes, so it reaches open tabs too.
 */
export function AnnouncementBanner({ className }: { className?: string }) {
  const [note, setNote] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => dismissedId());
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .announcement()
        .then((a) => alive && setNote(a))
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  if (!note || !announcementVisible(note.id, note.text, dismissed)) return null;
  const warning = note.tone === "warning";
  return (
    <div
      role="status"
      className={cx(
        "border-b px-4 py-2 text-sm",
        warning
          ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          : "border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-100",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl items-start gap-2">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">{note.text}</p>
        <button
          type="button"
          aria-label="Dismiss the announcement"
          onClick={() => {
            try {
              localStorage.setItem(DISMISSED_KEY, note.id ?? "");
            } catch {
              // storage unavailable: hidden until the page reloads
            }
            setDismissed(note.id);
          }}
          className={cx("rounded p-0.5 opacity-70 hover:opacity-100", focusRing)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
