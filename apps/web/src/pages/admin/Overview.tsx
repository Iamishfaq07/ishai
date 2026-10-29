import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminConfig, AdminNewsletterStats, AdminStats } from "@orbit/types";
import { Callout, ChevronDown, CountUp, Mail, Megaphone, buttonClass, cx, focusRing } from "@orbit/ui";
import { ColumnChart } from "../../components/ColumnChart";
import { Button, Input, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { WorkflowHealth } from "./WorkflowHealth";
import { count, inr, mins } from "./shared";

/** The server at a glance: a row of numbers, sign-ups and interview minutes per day, and the site announcement.
 * `version`: bumped by the list when accounts change (a delete, credits for many), so the numbers are re-read. */
export function AdminOverview({ version = 0 }: { version?: number }) {
  const stats = useAsync(() => api.adminStats(30), [version], "admin-stats");
  const s = stats.data;
  if (stats.error && !s) return <p className="mb-5 text-sm text-rose-600">Couldn't load the numbers: {errorText(stats.error)}</p>;
  return (
    <div className="mb-6 space-y-3">
      {s?.warnings?.includes("database_read_only") && (
        <Callout tone="error" title="The database is read-only">
          <p>
            It answers reads but refuses every write, so sign-ins, payments, sessions and saves fail, and new deploys fail their readiness check. In
            Railway's Postgres console, <code>SHOW default_transaction_read_only;</code> says <code>on</code> (or the database is a standby). Turn it
            off with <code>SET default_transaction_read_only = off;</code> then <code>ALTER DATABASE railway SET default_transaction_read_only = off;</code>{" "}
            (use the database's real name), then restart the API: its open connections keep the old setting.
          </p>
        </Callout>
      )}
      {s?.warnings?.includes("proxy_secret") && (
        <Callout tone="error" title="Proxy secret missing">
          <p>
            ORBIT_PROXY_SECRET isn't set on the API (or is too weak), so per-network limits can be dodged. Welcome credits are on hold and
            new deploys fail their readiness check until it's set. Set the same 32+ character value on the API host (ORBIT_PROXY_SECRET, in Railway) and in
            Cloudflare (<code>wrangler secret put PROXY_SECRET</code>).
          </p>
        </Callout>
      )}
      {s?.warnings?.includes("proxy_unsigned") && (
        <Callout tone="error" title="The website isn't sending the proxy secret">
          <p>
            Requests from the Cloudflare Worker reach the API without ORBIT_PROXY_SECRET, so the API can't see visitors' countries or IPs:
            everyone is priced in rupees as if in India, and web visitors share rate limits. Give the Worker the same value as the API host's
            ORBIT_PROXY_SECRET (<code>wrangler secret put PROXY_SECRET --name orbit</code>).
          </p>
        </Callout>
      )}
      {s?.warnings?.includes("api_cloudflare_proxied") && (
        <Callout tone="error" title="The API's address goes through Cloudflare's proxy">
          <p>
            Desktop requests reach the API through a Cloudflare edge, so the API sees that edge's address instead of the user's: everyone near
            one edge shares sign-in limits and welcome credits. In Cloudflare DNS, set the <code>api</code> record to DNS only (grey cloud).
          </p>
        </Callout>
      )}
      {s?.warnings?.includes("admin_two_factor") && (
        <Callout
          tone="warning"
          title="Turn on two-step sign-in for this account"
          action={
            <Link to="/settings#two-step" className={buttonClass("secondary", "sm")}>
              Set it up
            </Link>
          }
        >
          It can approve payments and change other accounts, so a stolen password shouldn't be enough to get in.
        </Callout>
      )}
      <StatTiles s={s} />
      <div className="grid gap-3 md:grid-cols-2">
        <ColumnChart
          title="Sign-ups per day"
          columns={daily(s?.signups)}
          unit={(n) => `${count(n)} sign-up${n === 1 ? "" : "s"}`}
          total={s ? `${count(sum(s.signups))} in ${s.days} days` : undefined}
          axis={[s?.signups[0] ? shortDay(s.signups[0].day) : "", "Today"]}
          header={["Day", "Sign-ups"]}
          empty={`None in the last ${s?.days ?? 30} days`}
          format={count}
          className={chartBox}
        />
        <ColumnChart
          title="Interview minutes per day"
          columns={daily(s?.interview_minutes)}
          unit={(n) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} min`}
          total={s ? `${mins(sum(s.interview_minutes))} in ${s.days} days · live and mock` : undefined}
          axis={[s?.interview_minutes[0] ? shortDay(s.interview_minutes[0].day) : "", "Today"]}
          header={["Day", "Minutes"]}
          empty={`None in the last ${s?.days ?? 30} days`}
          format={(n) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
          className={chartBox}
        />
      </div>
      <WorkflowHealth />
      <AnnouncementEditor />
      <NewsletterEditor />
    </div>
  );
}

function StatTiles({ s }: { s: AdminStats | null }) {
  const signups7 = s ? s.signups.slice(-7).reduce((a, d) => a + d.value, 0) : 0;
  // Each figure counts up once as the dashboard opens (Full motion); `format` writes it.
  const tiles: Array<{ label: string; value: number; format: (n: number) => string; note?: string; to?: string; alert?: boolean }> = s
    ? [
        { label: "Accounts", value: s.users, format: count, note: `${count(signups7)} new in 7 days${s.suspended ? ` · ${s.suspended} suspended` : ""}` },
        { label: "Active in the last 7 days", value: s.active_7d, format: count, note: `${count(s.active_30d)} in 30 days` },
        { label: "Revenue this month", value: s.revenue_month_inr, format: inr, note: `${inr(s.revenue_total_inr)} all time` },
        {
          label: "Payments to check",
          value: s.payments_waiting,
          format: count,
          note: s.payments_waiting ? "waiting for you" : "none waiting",
          to: "/admin/payments",
          alert: s.payments_waiting > 0,
        },
        { label: "Interview minutes this month", value: s.interview_minutes_month, format: mins, note: "live and mock, every account" },
        { label: "Resume credits used this month", value: s.resume_credits_used_month, format: count },
        { label: "Jobs fit checks this month", value: s.fit_checks_month, format: count },
        { label: "Paying accounts", value: s.paid_accounts, format: count, note: "with an approved payment" },
      ]
    : [];
  return (
    <div className={cx("grid grid-cols-2 gap-3 md:grid-cols-4", !s && "min-h-[10.5rem] animate-pulse rounded-2xl bg-zinc-500/5")} aria-busy={!s}>
      {tiles.map((tile) => {
        const body = (
          <>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</p>
            <p className="stat-value mt-1 font-display text-xl font-semibold">
              <CountUp to={tile.value} format={tile.format} />
            </p>
            {tile.note && <p className="text-xs text-zinc-500 dark:text-zinc-400">{tile.note}</p>}
          </>
        );
        const box = "glass-panel rounded-2xl p-3";
        return tile.to ? (
          <Link
            key={tile.label}
            to={tile.to}
            className={cx(box, "transition-colors", tile.alert ? "!border-amber-400/70" : "hover:!border-zinc-300 dark:hover:!border-white/20", focusRing)}
          >
            {body}
          </Link>
        ) : (
          <div key={tile.label} className={box}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const chartBox = "rounded-2xl border border-zinc-200 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.03]";
const sum = (days: Array<{ value: number }>) => Math.round(days.reduce((a, d) => a + d.value, 0) * 10) / 10;
const daily = (days: Array<{ day: string; value: number }> | undefined) =>
  days?.map((d) => ({ key: d.day, label: shortDay(d.day), value: d.value }));

/** The site-wide banner (above every signed-in page until dismissed): set, change or take it down. */
function AnnouncementEditor() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [text, setText] = useState("");
  const [tone, setTone] = useState<"info" | "warning">("info");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api
      .getAdminConfig()
      .then((c) => {
        setCfg(c);
        setText(c.announcement ?? "");
        setTone(c.announcement_tone ?? "info");
      })
      .catch(() => undefined);
  }, []);
  const save = async (next: string) => {
    setBusy(true);
    setNote(null);
    try {
      const c = await api.updateAdminConfig({ announcement: next, announcement_tone: tone });
      setCfg(c);
      setText(c.announcement ?? "");
      setNote(c.announcement ? "Saved. Everyone sees it above every page." : "Taken down.");
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const live = cfg?.announcement ?? "";
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/70 dark:border-white/10 dark:bg-white/[0.03]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx("flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm", focusRing)}
      >
        <Megaphone className="h-4 w-4 text-zinc-500" aria-hidden />
        <span className="font-medium">Site announcement</span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{live ? `Showing: ${live}` : "None showing"}</span>
        <ChevronDown className={cx("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-3 py-3 dark:border-white/10"
          onSubmit={(e) => {
            e.preventDefault();
            void save(text);
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Announcement text</span>
            <Input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Maintenance tonight 10–11 pm IST: live sessions may drop." />
          </label>
          <Select aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value as "info" | "warning")} className="!w-auto">
            <option value="info">Info</option>
            <option value="warning">Warning</option>
          </Select>
          <Button size="sm" type="submit" disabled={busy || !text.trim()}>
            Save
          </Button>
          {live && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save("")}>
              Take it down
            </Button>
          )}
          <p className="basis-full text-xs text-zinc-500 dark:text-zinc-400">
            One line, up to 300 characters. Shown above every signed-in page until each person dismisses it; a new text shows again.
          </p>
          {note && (
            <p className="basis-full text-xs" role="status">
              {note}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * The weekly tips and offers email (opt-in, newsletter.py): how many chose it, a note for the top of this week's
 * email (an offer, news) with a link, and a preview sent to the admin's own inbox.
 */
function NewsletterEditor() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<AdminNewsletterStats | null>(null);
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api.adminNewsletter().then(setStats, () => undefined);
    api
      .getAdminConfig()
      .then((c) => {
        setCfg(c);
        setText(c.newsletter_note ?? "");
        setLink(c.newsletter_link ?? "");
      })
      .catch(() => undefined);
  }, []);
  const save = async (nextText: string, nextLink: string) => {
    setBusy(true);
    setNote(null);
    try {
      const c = await api.updateAdminConfig({ newsletter_note: nextText, newsletter_link: nextLink });
      setCfg(c);
      setText(c.newsletter_note ?? "");
      setLink(c.newsletter_link ?? "");
      setNote(c.newsletter_note ? "Saved. It goes at the top of the next weekly emails." : "Removed.");
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const preview = async () => {
    setBusy(true);
    setNote(null);
    try {
      setNote(`Preview sent to ${(await api.previewNewsletter()).to}.`);
    } catch (err) {
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const live = cfg?.newsletter_note ?? "";
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/70 dark:border-white/10 dark:bg-white/[0.03]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx("flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm", focusRing)}
      >
        <Mail className="h-4 w-4 text-zinc-500" aria-hidden />
        <span className="font-medium">Weekly email</span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {stats ? `${count(stats.subscribed)} subscribed · ${count(stats.sent_last_week)} sent this week` : ""}
          {live ? ` · Note: ${live}` : ""}
        </span>
        <ChevronDown className={cx("h-4 w-4 text-zinc-400 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <form
          className="space-y-2 border-t border-zinc-200 px-3 py-3 dark:border-white/10"
          onSubmit={(e) => {
            e.preventDefault();
            void save(text, link);
          }}
        >
          {stats && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Opt-in only: {count(stats.subscribed)} chose it, {count(stats.declined)} said no or stopped it, {count(stats.never_asked)} not asked yet (Today asks them once).
            </p>
          )}
          <label className="block">
            <span className="text-xs font-medium">Note at the top of the email (an offer, news)</span>
            <Textarea value={text} maxLength={600} rows={3} onChange={(e) => setText(e.target.value)} placeholder="New this week: Plan my prep turns any company guide into a day-by-day plan." />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Link (an Orbit page like /billing, or an https:// address; optional)</span>
            <Input value={link} maxLength={300} onChange={(e) => setLink(e.target.value)} placeholder="/interview-questions" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" type="submit" disabled={busy || !text.trim()}>Save note</Button>
            {live && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save("", "")}>Remove note</Button>}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void preview()}>Send me a preview</Button>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Up to 600 characters, plain text. The rest of the email is built each week from what's true: two tools, new guides, FIRST10 for accounts that never paid, and their next interview.
          </p>
          {note && <p className="text-xs" role="status">{note}</p>}
        </form>
      )}
    </div>
  );
}
