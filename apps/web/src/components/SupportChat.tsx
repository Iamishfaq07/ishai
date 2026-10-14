import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import type { SupportThread } from "@orbit/ui";
import { ApiError, MessageCircle, Send, Skeleton, X, buttonClass, cx, focusRing } from "@orbit/ui";
import { Input } from "./ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SHELL_EVENTS } from "../lib/shell";

const Questions = lazy(() => import("./HelpDialog"));

const STORE = "orbit.support.v1";
const SEEN = "orbit.support.seen";

function scopeKey(base: string, userId?: string | null): string {
  return `${base}.${userId || "guest"}`;
}

interface Saved {
  id: string;
  token: string;
}

function load(userId?: string | null): Saved | null {
  try {
    const raw = localStorage.getItem(scopeKey(STORE, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Saved;
    return parsed.id && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function save(thread: SupportThread, userId?: string | null): Saved | null {
  if (!thread.token) return load(userId);
  const saved = { id: thread.id, token: thread.token };
  try {
    localStorage.setItem(scopeKey(STORE, userId), JSON.stringify(saved));
  } catch {
    // storage blocked or full: the chat still works for this visit
  }
  return saved;
}

function loadSeen(userId?: string | null): string {
  try {
    return localStorage.getItem(scopeKey(SEEN, userId)) ?? "";
  } catch {
    return "";
  }
}

function markSeen(id: string, userId?: string | null): void {
  if (!id) return;
  try {
    localStorage.setItem(scopeKey(SEEN, userId), id);
  } catch {
    // storage blocked: the unread dot may come back next visit
  }
}

/** A refresh that left before a send must not wipe the message that landed. */
function preferThread(current: SupportThread | null, next: SupportThread): SupportThread {
  if (current && current.id === next.id && current.messages.length > next.messages.length) return current;
  return next;
}

function hasUnseenReply(thread: SupportThread | null, seen: string): boolean {
  if (!thread) return false;
  const at = thread.messages.findIndex((m) => m.id === seen);
  const rest = at === -1 ? thread.messages : thread.messages.slice(at + 1);
  return rest.some((m) => m.role === "human");
}

/**
 * Support on every page except a live interview: the bot answers from Orbit's help notes, and Talk to a person
 * hands the same chat to the team (they reply in Admin → Support, and it shows up here).
 */
export function SupportChat() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userNow = useRef(userId);
  userNow.current = userId;
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState(false);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [saved, setSaved] = useState<Saved | null>(() => load(userId));
  const [forUser, setForUser] = useState(userId);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [needEmail, setNeedEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [seenId, setSeenId] = useState(() => loadSeen(userId));
  if (forUser !== userId) {
    setForUser(userId);
    setSaved(load(userId));
    setThread(null);
    setSeenId(loadSeen(userId));
    setText("");
    setError("");
  }
  const hidden = pathname.startsWith("/live");

  useEffect(() => {
    const onOpen = () => {
      if (!pathname.startsWith("/live")) setOpen(true);
    };
    window.addEventListener(SHELL_EVENTS.support, onOpen);
    return () => window.removeEventListener(SHELL_EVENTS.support, onOpen);
  }, [pathname]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    } else if (wasOpen.current) {
      launcherRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open || hidden) return;
    let cancel = false;
    const existing = load(userId);
    // A blip (offline, 503) must not throw this chat away and open another.
    // Only a confirmed missing thread starts a new one.
    const missing = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 410);
    const start = existing
      ? api.supportRead(existing.id, existing.token, pathname).catch((err: unknown) => (
        missing(err) ? api.supportOpen(pathname) : Promise.reject(err)
      ))
      : api.supportOpen(pathname);
    void start.then((next) => {
      if (cancel) return;
      setThread((current) => preferThread(current, next));
      const kept = save(next, userId) ?? existing;
      if (kept) setSaved(kept);
    }).catch(() => {
      if (!cancel) setError("Support is unavailable right now.");
    });
    return () => {
      cancel = true;
    };
  }, [open, hidden, pathname, userId]);

  useEffect(() => {
    if (!open || !saved || thread?.status !== "waiting") return;
    let cancel = false;
    const ticket = saved;
    const pull = () => {
      if (cancel || document.hidden) return;
      void api.supportRead(ticket.id, ticket.token).then((next) => {
        if (cancel) return;
        setThread((current) => preferThread(current, next));
      }).catch(() => undefined);
    };
    const timer = window.setInterval(pull, 4000);
    document.addEventListener("visibilitychange", pull);
    return () => {
      cancel = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [open, saved, thread?.status]);

  // Closed, and a person has the chat: look for their reply so the icon can show a dot.
  useEffect(() => {
    if (hidden || open) return;
    const existing = load(userId);
    if (!existing) return;
    if (thread && thread.status !== "waiting") return;
    let cancel = false;
    const tick = () => {
      if (document.hidden) return;
      void api.supportRead(existing.id, existing.token).then((next) => {
        if (cancel) return;
        setThread((current) => preferThread(current, next));
        setSaved(existing);
      }).catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 12000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [hidden, open, thread?.status, userId]);

  useEffect(() => {
    if (!open || !thread?.messages.length) return;
    const last = thread.messages[thread.messages.length - 1]?.id;
    if (!last || last === seenId) return;
    setSeenId(last);
    markSeen(last, userId);
  }, [open, thread?.messages, seenId, userId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [thread?.messages.length, thread?.suggestions?.length, open]);

  if (hidden) return null;

  async function send(choice?: { id: string; label: string }) {
    if (!saved || busy) return;
    if (choice?.id === "human") {
      await handoff();
      return;
    }
    const typed = text.trim();
    if (!choice && !typed) return;
    const mine = userId;
    const ticket = saved;
    setBusy(true);
    setError("");
    try {
      const next = await api.supportSend(ticket.id, ticket.token, choice?.label ?? typed, choice?.id, pathname);
      if (userNow.current !== mine) return;
      setThread(next);
      setText("");
    } catch (err) {
      if (userNow.current === mine) setError(err instanceof Error ? err.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  }

  async function handoff() {
    if (!saved || busy) return;
    const address = (email || user?.email || "").trim();
    if (!address.includes("@")) {
      setNeedEmail(true);
      setError("Add your email so the team knows who to reply to.");
      return;
    }
    const mine = userId;
    const ticket = saved;
    setBusy(true);
    setError("");
    try {
      const next = await api.supportHandoff(ticket.id, ticket.token, user?.name || "", address);
      if (userNow.current !== mine) return;
      setThread(next);
      setNeedEmail(false);
    } catch (err) {
      if (userNow.current === mine) setError(err instanceof Error ? err.message : "Couldn't reach a person.");
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    const mine = userId;
    try {
      localStorage.removeItem(scopeKey(STORE, mine));
      localStorage.removeItem(scopeKey(SEEN, mine));
    } catch {
      // storage unavailable: the new chat still starts for this visit
    }
    setSeenId("");
    setSaved(null);
    setThread(null);
    setBusy(true);
    setError("");
    try {
      const next = await api.supportOpen();
      if (userNow.current !== mine) return;
      setThread(next);
      const kept = save(next, mine);
      if (kept) setSaved(kept);
    } catch (err) {
      if (userNow.current === mine) setError(err instanceof Error ? err.message : "Couldn't start a new chat.");
    } finally {
      setBusy(false);
    }
  }

  const signedIn = Boolean(user);
  const unread = !open && hasUnseenReply(thread, seenId);

  return (
    <div
      className={cx(
        "pointer-events-none fixed right-3 z-40 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col items-end gap-3",
        // Signed-in phones have a tab bar. Sit just above it. Everywhere else, the corner itself.
        signedIn
          ? "bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-5 md:right-5"
          : "bottom-[max(0.75rem,env(safe-area-inset-bottom))] md:bottom-5 md:right-5",
      )}
    >
      {open && (
        <section
          aria-label="Support chat"
          className="pointer-events-auto flex h-[min(32rem,70vh)] w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-950"
        >
          <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
            <MessageCircle className="h-4 w-4 text-indigo-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold">Orbit support</p>
              <p className="text-xs text-zinc-500">{thread?.status === "waiting" ? "A person has this chat" : "Bot, then a person if you need one"}</p>
            </div>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setQuestions(true)}>
              Questions
            </button>
            <button type="button" className={buttonClass("ghost", "sm", "grid h-9 w-9 place-items-center p-0")} onClick={() => setOpen(false)} aria-label="Close support">
              <X className="h-4 w-4" />
            </button>
          </header>
          <div ref={scroller} role="log" aria-live="polite" aria-relevant="additions" className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {(thread?.messages ?? []).map((m) => (
              <p
                key={m.id}
                className={cx(
                  "max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                  m.role === "user"
                    ? "ml-auto bg-indigo-600 text-white"
                    : m.role === "human"
                      ? "bg-emerald-600/10 text-emerald-950 ring-1 ring-emerald-600/20 dark:text-emerald-100"
                      : "bg-zinc-100 text-zinc-800 dark:bg-white/10 dark:text-zinc-100",
                )}
              >
                {m.role === "human" && <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide">Orbit</span>}
                {m.text}
              </p>
            ))}
            {!thread && !error && <Skeleton variant="line" count={3} label="Opening chat" />}
          </div>
          {error && <p role="alert" className="px-3 pb-1 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
          {thread?.status === "closed" ? (
            <div className="border-t border-zinc-200 p-3 dark:border-white/10">
              <button type="button" onClick={() => void restart()} disabled={busy} className={buttonClass("secondary", "sm", "w-full")}>
                Start a new chat
              </button>
            </div>
          ) : (
          <>
          {thread?.status !== "waiting" && (
            <div className="px-3 pb-1">
              {needEmail && !user?.email && (
                <label className="mb-2 block">
                  <span className="sr-only">Your email, so the team can reply</span>
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Your email"
                    type="email"
                    autoComplete="email"
                    className="w-full"
                  />
                </label>
              )}
              {thread?.status === "bot" && (thread.suggestions?.length ?? 0) > 0 ? (
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pb-1">
                  {thread.suggestions?.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy || !saved}
                      onClick={() => void send(s)}
                      className={cx(
                        "min-h-9 rounded-full border px-3 py-1.5 text-left text-xs font-medium disabled:opacity-40",
                        s.id === "human"
                          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-indigo-200"
                          : "border-zinc-200 text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-white/10 dark:text-zinc-200 dark:hover:border-indigo-400/40 dark:hover:bg-indigo-500/10",
                        focusRing,
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : (
                <button type="button" onClick={() => void handoff()} disabled={busy || !saved} className={buttonClass("ghost", "sm")}>
                  Talk to a person
                </button>
              )}
            </div>
          )}
          <form
            ref={formRef}
            className="flex gap-2 border-t border-zinc-200 p-3 dark:border-white/10"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Message</span>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={thread?.status === "waiting" ? "Message the person who has this chat…" : "Or type a question…"}
                className="w-full"
              />
            </label>
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className={buttonClass("primary", "md", "grid h-11 w-11 shrink-0 place-items-center p-0")}>
              <Send className="h-4 w-4" />
            </button>
          </form>
          </>
          )}
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        ref={launcherRef}
        aria-expanded={open}
        aria-label={unread ? "Support chat, new reply" : open ? "Close support chat" : "Chat with support"}
        className={cx(
          "pointer-events-auto relative grid h-12 w-12 place-items-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-950/30 hover:bg-indigo-500",
          focusRing,
        )}
      >
        {unread && <span className="absolute right-0 top-0 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white dark:ring-zinc-950" />}
        {open ? <X className="h-5 w-5" aria-hidden /> : <MessageCircle className="h-5 w-5" aria-hidden />}
      </button>
      {questions && (
        <Suspense fallback={null}>
          <Questions
            open
            onClose={() => setQuestions(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
