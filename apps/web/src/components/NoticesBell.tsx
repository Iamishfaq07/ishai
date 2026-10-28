import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Gift, buttonClass, cx, floatingClass, focusRing, useDismiss } from "@orbit/ui";
import type { AccountNotice } from "@orbit/types";
import { readNotices, useNotices } from "../lib/notices";

export function noticeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The header's bell: credits, plans, approvals and purchases added to the account. Opening it reads them all. */
export function NoticesBell() {
  const notices = useNotices();
  const [open, setOpen] = useState(false);
  // What was new when the panel opened keeps its dot while it's open, though it's already marked read.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref, buttonRef);
  const unread = notices?.unread ?? 0;
  useEffect(() => {
    if (!open) return;
    setFresh(new Set((notices?.items ?? []).filter((n) => !n.read).map((n) => n.id)));
    void readNotices();
    // Only on opening: the read itself updates `notices`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (notices === null) return null;
  const label = unread ? `Notifications, ${unread} new` : "Notifications";
  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cx(
          "relative grid h-11 w-11 place-items-center rounded-xl text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 md:h-9 md:w-9 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
          focusRing,
        )}
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white md:right-0.5 md:top-0.5"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={cx(
            floatingClass("menu"),
            "fixed inset-x-3 top-16 z-30 origin-top animate-menu-in sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:origin-top-right",
          )}
        >
          <p className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-white/10">Notifications</p>
          {notices.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-600 dark:text-zinc-400">
              Nothing yet. Credits, plans and purchases added to your account show up here.
            </p>
          ) : (
            <ul className="max-h-[min(24rem,70vh)] divide-y divide-zinc-200 overflow-y-auto dark:divide-white/10">
              {notices.items.map((n) => (
                <li key={n.id}>
                  <NoticeRow notice={n} isNew={fresh.has(n.id)} onOpen={close} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NoticeRow({ notice: n, isNew, onOpen }: { notice: AccountNotice; isNew: boolean; onOpen: () => void }) {
  const body = (
    <>
      <span className="flex items-start gap-2">
        {isNew && (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600">
            <span className="sr-only">New: </span>
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-zinc-900 dark:text-white">{n.title}</span>
          {n.body && <span className="mt-0.5 block text-zinc-600 dark:text-zinc-400">{n.body}</span>}
          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{noticeTime(n.created_at)}</span>
        </span>
      </span>
    </>
  );
  const row = "block px-4 py-3 text-sm";
  return n.link ? (
    <Link to={n.link} onClick={onOpen} className={cx(row, "hover:bg-zinc-900/[0.03] dark:hover:bg-white/5", focusRing)}>
      {body}
    </Link>
  ) : (
    <div className={row}>{body}</div>
  );
}

/** Today: the newest thing the account was given and hasn't seen, until it's read here or in the bell. */
export function NewNoticeCard() {
  const notices = useNotices();
  const n = notices?.items.find((i) => !i.read);
  if (!n) return null;
  return (
    <section
      aria-label="New on your account"
      className="flex flex-col gap-3 rounded-2xl bg-emerald-50 px-5 py-4 ring-1 ring-emerald-200 sm:flex-row sm:items-center sm:gap-6 dark:bg-emerald-500/10 dark:ring-emerald-500/20"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Gift className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold text-zinc-900 dark:text-white">{n.title}</p>
          {n.body && <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">{n.body}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-8 sm:pl-0">
        {n.link && (
          <Link to={n.link} onClick={() => void readNotices([n.id])} className={buttonClass("secondary", "sm")}>
            {n.link === "/billing" ? "See your balance" : "Open"}
          </Link>
        )}
        <button type="button" onClick={() => void readNotices([n.id])} className={buttonClass("ghost", "sm")}>
          Got it
        </button>
      </div>
    </section>
  );
}
