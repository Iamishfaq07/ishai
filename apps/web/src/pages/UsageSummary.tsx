import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Callout, CountUp, Crown, LoadGate, Mic, Sparkles, cx, focusRing, type LucideIcon } from "@orbit/ui";
import type { Entitlements } from "@orbit/types";
import { ErrorNote } from "../components/ui";
import { api } from "../lib/api";
import { contactHref } from "../lib/contactForm";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { RESUME_AI_HOME } from "./resume/paths";

// What an account has left (credits on Free, the monthly allowance on a plan): Home's summary card and the top of
// Plan & billing. Its own module so Home doesn't download the whole billing page (checkout, packs, referrals) with it.

function Bar({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      <div
        className={pct >= 90 ? "h-full bg-rose-500" : "h-full bg-indigo-500"}
        style={{ width: limit ? `${pct}%` : "0%" }}
      />
    </div>
  );
}

// The two balances wear their product's colour: interview minutes the copilot's, Resume AI credits Resume AI's.
const BALANCE_TONE = {
  interview: { tile: "bg-indigo-500/[0.06] ring-indigo-500/15 dark:bg-indigo-400/[0.07] dark:ring-indigo-300/15", chip: "bg-indigo-500/15 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200" },
  resume: { tile: "bg-emerald-500/[0.06] ring-emerald-600/15 dark:bg-emerald-400/[0.07] dark:ring-emerald-300/15", chip: "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200" },
};

/** One balance as a big number (counting up the first time it shows), what it's for underneath. */
function Balance({ icon: Icon, tone, value, unit, label, children }: { icon: LucideIcon; tone: keyof typeof BALANCE_TONE; value: number | null; unit: string; label: string; children: ReactNode }) {
  const t = BALANCE_TONE[tone];
  return (
    <div className={cx("rounded-xl p-4 ring-1", t.tile)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span aria-hidden="true" className={cx("flex h-8 w-8 items-center justify-center rounded-lg", t.chip)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1 font-display text-3xl font-semibold tracking-tight">
        {value === null ? "Unlimited" : <CountUp to={value} />}
        {value !== null && <span className="ml-1 text-sm font-medium text-zinc-500">{unit}</span>}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{children}</p>
    </div>
  );
}

/** The credits left on a Free account: resume AI and interview minutes (live and mock share them). */
export function CreditRows({ e, wide = false }: { e: Entitlements; wide?: boolean }) {
  const c = e.credits;
  if (!c) return null;
  const empty = Math.round(c.interview_minutes_left) <= 0 && c.resume === 0;
  return (
    <div className="space-y-4">
      {/* Side by side when the card has room for both (13rem each), stacked when it doesn't: Home puts this card in
          a full row or beside Recent sessions, Plan & billing in a narrow column. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
        <Balance icon={Mic} tone="interview" value={Math.round(c.interview_minutes_left)} unit="min left" label="Interview minutes">
          Live and mock interviews both use these. 60 minutes = 1 interview credit.
        </Balance>
        <Balance icon={Sparkles} tone="resume" value={c.resume} unit="left" label="Resume AI credits">
          For{" "}
          <Link to={RESUME_AI_HOME} className={cx("font-medium text-indigo-600 hover:underline dark:text-indigo-300", focusRing)}>
            Resume AI
          </Link>
          : one per import, tailoring, cover letter, profile or message; a single AI fix uses a fifth.
        </Balance>
      </div>
      {empty && c.welcome_missed && (
        <Callout tone="warning" title="No free credits on this account">
          The free starter credits go to one new
          account per network each month (Wi-Fi and mobile data are often shared) and one per inbox, so this one didn't
          get them. A pack adds credits right away.{" "}
          <Link
            to={contactHref({ topic: "payment", from: "/billing" })}
            className={cx("font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300", focusRing)}
          >
            Think that's wrong? Tell us
          </Link>
        </Callout>
      )}
      {empty && wide && (
        <Link to="/billing" className={cx("inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
          <Crown className="h-4 w-4 text-amber-500" aria-hidden="true" /> Top up with a pack. Pay once, nothing renews.
        </Link>
      )}
      <p className="text-xs text-zinc-500">
        Credits never expire. Screenshots: {e.usage.screenshots} / {e.limits.screenshots ?? "∞"} this month · Documents:{" "}
        {e.usage.documents} / {e.limits.documents ?? "∞"} · Sessions up to {e.limits.max_session_minutes} min.
      </p>
    </div>
  );
}

/** Plans with their own monthly allowance (Pro or Unlimited, granted by the admin). */
export function UsageRows({ e }: { e: Entitlements }) {
  const rows = [
    { label: "Live minutes", used: Math.round(e.usage.live_minutes), limit: e.limits.live_minutes },
    { label: "Mock interview minutes", used: Math.round(e.usage.mock_minutes), limit: e.limits.mock_minutes },
    { label: "Screenshots", used: e.usage.screenshots, limit: e.limits.screenshots },
    { label: "Documents", used: e.usage.documents, limit: e.limits.documents },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{r.label}</span>
            <span className="tabular-nums text-zinc-500">
              {r.used.toLocaleString()}
              {r.limit !== null ? ` / ${r.limit.toLocaleString()}` : " · unlimited"}
            </span>
          </div>
          {r.limit !== null && <Bar used={r.used} limit={r.limit} />}
        </div>
      ))}
      <p className="text-xs text-zinc-500">Each session can run up to {e.limits.max_session_minutes} minutes.</p>
      {e.saved_credits && <SavedCredits saved={e.saved_credits} />}
    </div>
  );
}

/** Credits bought or given before the plan: kept, not spent while it runs, and there for after it. */
export function SavedCredits({ saved }: { saved: NonNullable<Entitlements["saved_credits"]> }) {
  const minutes = Math.floor(saved.interview_minutes_left);
  const parts = [
    minutes >= 1 && `${minutes.toLocaleString()} interview minute${minutes === 1 ? "" : "s"}`,
    saved.resume > 0 && `${saved.resume.toLocaleString()} Resume AI credit${saved.resume === 1 ? "" : "s"}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <p className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-300">
      <span className="font-medium text-zinc-800 dark:text-zinc-100">Your credits are kept:</span> {parts.join(" and ")}. They aren't used while
      your plan runs, and they don't expire.
    </p>
  );
}

/** Home's summary card: credits on Free, the monthly allowance otherwise. */
export function UsageSummary() {
  const ent = useAsync(() => api.entitlements(), [], "entitlements");
  return (
    <LoadGate loading={ent.loading && !ent.data} variant="line" count={4} label="Loading your plan">
      {ent.error ? (
        <ErrorNote onRetry={ent.reload}>{errorText(ent.error)}</ErrorNote>
      ) : ent.data ? (
        ent.data.credits ? <CreditRows e={ent.data} wide /> : <UsageRows e={ent.data} />
      ) : null}
    </LoadGate>
  );
}
