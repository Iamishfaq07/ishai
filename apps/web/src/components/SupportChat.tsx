import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import type { SupportThread } from "@orbit/ui";
import { MessageCircle, Send, Skeleton, X, buttonClass, cx, focusRing } from "@orbit/ui";
import { Input } from "./ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SHELL_EVENTS } from "../lib/shell";

const Questions = lazy(() => import("./HelpDialog"));

const STORE = "orbit.support.v1";
const SEEN = "orbit.support.seen";

interface Saved {
  id: string;
  token: string;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Saved;
    return parsed.id && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function save(thread: SupportThread): Saved | null {
  if (!thread.token) return load();
  const saved = { id: thread.id, token: thread.token };
  localStorage.setItem(STORE, JSON.stringify(saved));
  return saved;
}

function loadSeen(): string {
  try {
    return localStorage.getItem(SEEN) ?? "";
  } catch {
    return "";
  }
}

function markSeen(id: string): void {
  if (!id) return;
  localStorage.setItem(SEEN, id);
}

/** A person replied after the visitor last had this chat open. */
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
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState(false);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [needEmail, setNeedEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [seenId, setSeenId] = useState(loadSeen);
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
    const existing = load();
    const start = existing
      ? api.supportRead(existing.id, existing.token, pathname).catch(() => api.supportOpen(pathname))
      : api.supportOpen(pathname);
    void start.then((next) => {
      if (cancel) return;
      setThread(next);
      const kept = save(next) ?? existing;
      if (kept) setSaved(kept);
    }).catch(() => {
      if (!cancel) setError("Support is unavailable right now.");
    });
    return () => {
      cancel = true;
    };
  }, [open, hidden, pathname]);

  useEffect(() => {
    if (!open || !saved || thread?.status !== "waiting") return;
    const timer = window.setInterval(() => {
      void api.supportRead(saved.id, saved.token).then(setThread).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [open, saved, thread?.status]);

  // Closed, and a person has the chat: look for their reply so the icon can show a dot.
  useEffect(() => {
    if (hidden || open) return;
    const existing = load();
    if (!existing) return;
    if (thread && thread.status !== "waiting") return;
    let cancel = false;
    const tick = () => {
      void api.supportRead(existing.id, existing.token).then((next) => {
        if (cancel) return;
        setThread(next);
        setSaved(existing);
      }).catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 12000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [hidden, open, thread?.status]);

  useEffect(() => {
    if (!open || !thread?.messages.length) return;
    const last = thread.messages[thread.messages.length - 1]?.id;
    if (!last || last === seenId) return;
    setSeenId(last);
    markSeen(last);
  }, [open, thread?.messages, seenId]);

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
    setBusy(true);
    setError("");
    try {
      setThread(await api.supportSend(saved.id, saved.token, choice?.label ?? typed, choice?.id, pathname));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that.");
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
    setBusy(true);
    setError("");
    try {
      setThread(await api.supportHandoff(saved.id, saved.token, user?.name || "", address));
      setNeedEmail(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach a person.");
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    localStorage.removeItem(STORE);
    localStorage.removeItem(SEEN);
    setSeenId("");
    setSaved(null);
    setThread(null);
    setBusy(true);
    setError("");
    try {
      const next = await api.supportOpen();
      setThread(next);
      const kept = save(next);
      if (kept) setSaved(kept);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a new chat.");
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
