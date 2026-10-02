import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CompanionView } from "@orbit/types";
import {
  AnswerCard,
  ApiError,
  ChevronLeft,
  ChevronRight,
  LiveClient,
  OrbitLogo,
  QuestionCard,
  Smartphone,
  StatusPill,
  cx,
  focusRing,
  initialLiveState,
  liveReducer,
  selectDisplayedAnswer,
  selectDisplayedQuestion,
  useAnswerHistory,
  type LiveAction,
  type LiveViewState,
  type QuestionView,
} from "@orbit/ui";
import { Spinner } from "../components/ui";
import { LIVE_URL, api } from "../lib/api";
import { errorText } from "../lib/format";

type CompanionAction = LiveAction | { type: "companion/reset" };

/** The phone replays recent events on every (re)connect, so a reconnect starts from a clean slate. */
function companionReducer(s: LiveViewState, action: CompanionAction): LiveViewState {
  if (action.type === "companion/reset") return { ...initialLiveState(), connection: s.connection };
  return liveReducer(s, action);
}

/** Keep the phone's screen on while it's following a session (where the browser allows it). */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    request();
    document.addEventListener("visibilitychange", request); // the lock drops whenever the tab is hidden
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, [active]);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center">{children}</div>
  );
}

function EndNote({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-500/20">
        <Smartphone className="h-6 w-6" />
      </span>
      <div className="max-w-xs">
        <h1 className="font-display text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{body}</p>
      </div>
    </Shell>
  );
}

const CODE_KEY = "orbit.companionCode";

/** The share code from the scanned link (`#<code>`), else the one this tab read before a reload. */
function readCode(): string {
  const fromLink = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (fromLink) return fromLink;
  try {
    return sessionStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The session ended or the code expired: a reload should ask for a fresh scan, not retry a dead code. */
function forgetCode(): void {
  try {
    sessionStorage.removeItem(CODE_KEY);
  } catch {
    // storage unavailable: nothing was kept
  }
}

/**
 * Phone companion (`/companion#<code>`, no sign-in): a read-only second screen for a live session. The computer
 * shows a QR code; this page follows the live question and answer. Nothing is captured or sent from the phone.
 */
export function CompanionPage() {
  const code = useMemo(readCode, []);
  const [view, setView] = useState<CompanionView | null>(null);
  const [error, setError] = useState<string | null>(code ? null : "missing");

  useEffect(() => {
    if (!code) return;
    // Keep the code out of the address bar (and so out of history and screenshots) once it's been read. It stays in
    // this tab's sessionStorage, so reloading the page (or the phone reloading it) still finds the session.
    window.history.replaceState(null, "", window.location.pathname);
    try {
      sessionStorage.setItem(CODE_KEY, code);
    } catch {
      // storage unavailable: a reload will need a fresh scan
    }
    api
      .redeemCompanion(code)
      .then(setView)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) forgetCode();
        setError(errorText(err));
      });
  }, [code]);

  if (error === "missing") {
    return <EndNote title="Scan the code on your computer" body="In a live session, tap the phone icon at the top of the panel and scan the QR code with your camera." />;
  }
  if (error) return <EndNote title="This link doesn’t work anymore" body={error} />;
  if (!view) {
    return (
      <Shell>
        <Spinner label="Connecting to your session" />
      </Shell>
    );
  }
  return <CompanionRoom code={code} view={view} />;
}

function CompanionRoom({ code, view }: { code: string; view: CompanionView }) {
  const [live, dispatch] = useReducer(companionReducer, undefined, () => initialLiveState());
  const firstTicket = useRef<string | null>(view.ticket);

  const client = useMemo(
    () =>
      new LiveClient({
        apiBaseUrl: LIVE_URL,
        sessionId: view.session_id,
        path: "view",
        // The first ticket came with the page; every reconnect trades the code for a fresh one.
        getTicket: async () => {
          const first = firstTicket.current;
          firstTicket.current = null;
          return first ?? (await api.redeemCompanion(code)).ticket;
        },
        onOpen: (_c, isReconnect) => {
          if (isReconnect) dispatch({ type: "companion/reset" });
        },
      }),
    [code, view.session_id],
  );

  useEffect(() => {
    const offEvents = client.on(dispatch);
    const offStatus = client.onStatus((status, detail) =>
      dispatch({ type: "local/connection", status, ...(detail ? { detail } : {}) }),
    );
    client.connect();
    return () => {
      offEvents();
      offStatus();
      client.close();
    };
  }, [client]);

  const ended = live.state === "ended";
  const disconnected = live.connection === "closed" && !ended;
  useWakeLock(!ended && !disconnected);
  useEffect(() => {
    if (ended) forgetCode();
  }, [ended]);

  const actions = useMemo(
    () => ({ viewAnswer: (id: string | null) => dispatch({ type: "local/view", answer_id: id }) }),
    [],
  );
  const { history, index, browsing, newAnswer, step, backToLive } = useAnswerHistory(live, actions);
  const answer = selectDisplayedAnswer(live);
  const question: QuestionView | null =
    selectDisplayedQuestion(live) ??
    (live.mock
      ? { question_id: live.mock.questionId, turn_id: null, text: live.mock.text, type: "behavioral", confidence: 1, is_follow_up: live.mock.isFollowUp }
      : null);
  const pinned = live.pinnedAnswerId !== null;

  if (ended) {
    return (
      <EndNote
        title="The session has ended"
        body="Your transcript and review are on your computer, under Sessions. You can close this page."
      />
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center gap-2.5 border-b border-zinc-200 bg-white/90 px-4 py-2.5 dark:border-white/[0.06] dark:bg-zinc-950/85">
        <OrbitLogo size={18} busy={live.state === "generating" || live.state === "streaming"} />
        <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold">{view.title}</span>
        <StatusPill state={live.state} connection={live.connection} />
      </header>

      {disconnected && (
        <div role="alert" className="flex items-center gap-3 bg-rose-50 px-4 py-2 text-xs text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
          <span className="flex-1">{live.connectionDetail ?? "Lost the connection to your session."}</span>
          <button
            type="button"
            onClick={() => client.connect()}
            className={cx("shrink-0 rounded-md bg-white/70 px-2 py-1 font-medium dark:bg-white/10", focusRing)}
          >
            Reconnect
          </button>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col bg-white/80 dark:bg-zinc-950/70">
        <div className="border-b border-zinc-200 dark:border-white/[0.06]">
          <QuestionCard question={question} liveTurn={null} />
        </div>
        <AnswerCard
          answer={answer}
          pinned={pinned}
          onPin={(p) => answer && dispatch({ type: "local/pin", answer_id: answer.answer_id, pinned: p })}
          onRetry={() => undefined}
          readOnly
          autoAnswer={live.settings.auto_answer}
        />
      </main>

      {history.length > 1 && (
        <nav
          aria-label="Earlier answers"
          className="flex items-center gap-2 border-t border-zinc-200 bg-white/80 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs dark:border-white/[0.06] dark:bg-zinc-950/80"
        >
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={pinned || index <= 0}
            className={cx("inline-flex items-center gap-1 rounded-lg px-3 py-2 disabled:opacity-40", focusRing)}
          >
            <ChevronLeft className="h-4 w-4" /> Earlier
          </button>
          <span className="flex-1 text-center tabular-nums text-zinc-500 dark:text-zinc-400">
            {browsing ? (
              <button
                type="button"
                onClick={backToLive}
                className={cx("rounded-lg px-2 py-1 font-medium text-indigo-600 dark:text-indigo-300", focusRing)}
              >
                {newAnswer ? "New answer — back to live" : "Back to live"}
              </button>
            ) : (
              `${index + 1} of ${history.length}`
            )}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={pinned || index >= history.length - 1}
            className={cx("inline-flex items-center gap-1 rounded-lg px-3 py-2 disabled:opacity-40", focusRing)}
          >
            Later <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  );
}
