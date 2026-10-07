import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import type { AdminConfig, AdminStats } from "@orbit/types";
import { ChevronDown, Megaphone, cx, focusRing } from "@orbit/ui";
import { Button, Input, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { niceCeiling } from "./logic";
import { count, inr, mins } from "./shared";

/** The server at a glance: a row of numbers, sign-ups and interview minutes per day, and the site announcement.
 * `version`: bumped by the list when accounts change (a delete, credits for many), so the numbers are re-read. */
export function AdminOverview({ version = 0 }: { version?: number }) {
  const stats = useAsync(() => api.adminStats(30), [version], "admin-stats");
  const s = stats.data;
  if (stats.error && !s) return <p className="mb-5 text-sm text-rose-600">Couldn't load the numbers: {errorText(stats.error)}</p>;
  return (
    <div className="mb-6 space-y-3">
      <StatTiles s={s} />
      <div className="grid gap-3 md:grid-cols-2">
        <DailyBars title="Sign-ups per day" data={s?.signups} unit={(n) => `${count(n)} sign-up${n === 1 ? "" : "s"}`} total={(n) => `${count(n)} in ${s?.days ?? 30} days`} />
        <DailyBars
          title="Interview minutes per day"
          data={s?.interview_minutes}
          unit={(n) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} min`}
          total={(n) => `${mins(n)} in ${s?.days ?? 30} days · live and mock`}
        />
      </div>
      <AnnouncementEditor />
    </div>
  );
}

function StatTiles({ s }: { s: AdminStats | null }) {
  const signups7 = s ? s.signups.slice(-7).reduce((a, d) => a + d.value, 0) : 0;
  const tiles: Array<{ label: string; value: string; note?: string; to?: string; alert?: boolean }> = s
    ? [
        { label: "Accounts", value: count(s.users), note: `${count(signups7)} new in 7 days${s.suspended ? ` · ${s.suspended} suspended` : ""}` },
        { label: "Active in the last 7 days", value: count(s.active_7d), note: `${count(s.active_30d)} in 30 days` },
        { label: "Revenue this month", value: inr(s.revenue_month_inr), note: `${inr(s.revenue_total_inr)} all time` },
        {
          label: "Payments to check",
          value: count(s.payments_waiting),
          note: s.payments_waiting ? "waiting for you" : "none waiting",
          to: "/admin/payments",
          alert: s.payments_waiting > 0,
        },
        { label: "Interview minutes this month", value: mins(s.interview_minutes_month), note: "live and mock, every account" },
        { label: "Resume AI credits used this month", value: count(s.resume_credits_used_month) },
        { label: "Jobs AI fit checks this month", value: count(s.fit_checks_month) },
        { label: "Paying accounts", value: count(s.paid_accounts), note: "with an approved payment" },
      ]
    : [];
  return (
    <div className={cx("grid grid-cols-2 gap-3 md:grid-cols-4", !s && "min-h-[10.5rem] animate-pulse rounded-2xl bg-zinc-500/5")} aria-busy={!s}>
      {tiles.map((tile) => {
        const body = (
          <>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</p>
            <p className="mt-1 font-display text-xl font-semibold">{tile.value}</p>
            {tile.note && <p className="text-xs text-zinc-500 dark:text-zinc-400">{tile.note}</p>}
          </>
        );
        const box = "rounded-2xl border bg-white/70 p-3 dark:bg-white/[0.03]";
        return tile.to ? (
          <Link
            key={tile.label}
            to={tile.to}
            className={cx(box, tile.alert ? "border-amber-400/60" : "border-zinc-200 dark:border-white/10", "hover:border-indigo-400/50", focusRing)}
          >
            {body}
          </Link>
        ) : (
          <div key={tile.label} className={cx(box, "border-zinc-200 dark:border-white/10")}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** The element's width in CSS pixels, kept current (the chart draws in real pixels: exact 2 px gaps and 4 px ends). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

const PLOT_H = 96;

/** A bar for each day; its top end rounded (4 px), square at the baseline. */
function barPath(x: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  const top = PLOT_H - h;
  return `M${x},${PLOT_H}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${PLOT_H}Z`;
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * One series per day as columns (one hue: the title says what it is, so there's no legend). Hover or arrow keys show a
 * day's value; the busiest day carries its number; "Show the numbers" is the table view.
 */
function DailyBars({
  title,
  data,
  unit,
  total,
}: {
  title: string;
  data: Array<{ day: string; value: number }> | undefined;
  unit: (n: number) => string;
  total: (n: number) => string;
}) {
  const [box, width] = useWidth<HTMLDivElement>(480);
  const [active, setActive] = useState<number | null>(null);
  const days = data ?? [];
  const n = Math.max(days.length, 1);
  const max = Math.max(0, ...days.map((d) => d.value));
  const ceiling = niceCeiling(max);
  const slot = width / n;
  const barW = Math.max(1, Math.min(24, slot - 2));
  let peak = -1;
  days.forEach((d, i) => {
    if (max > 0 && d.value === max) peak = i;
  });
  const sum = days.reduce((a, d) => a + d.value, 0);
  const shown = active !== null ? days[active] : undefined;
  const onKey = (e: KeyboardEvent) => {
    if (!days.length) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const from = active ?? days.length - 1;
      setActive(Math.min(days.length - 1, Math.max(0, from + (e.key === "ArrowLeft" ? -1 : 1))));
    }
  };
  return (
    // min-w-0: the grid cell takes the column's width, so the chart measures that (not its own first drawing).
    <figure className="min-w-0 rounded-2xl border border-zinc-200 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{data ? total(Math.round(sum * 10) / 10) : "…"}</span>
      </figcaption>
      <div
        ref={box}
        tabIndex={days.length ? 0 : -1}
        role="group"
        aria-label={`${title}. Use the arrow keys to read each day.`}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => a ?? (days.length ? days.length - 1 : null))}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className={cx("relative mt-2 rounded-md", focusRing, !data && "opacity-50")}
      >
        <span className="absolute left-0 top-0 text-[10px] tabular-nums leading-none text-zinc-500 dark:text-zinc-400" aria-hidden>
          {ceiling.toLocaleString("en-IN")}
        </span>
        <svg width={width} height={PLOT_H} className="block overflow-visible" aria-hidden>
          {[0, 0.5].map((f) => (
            <line key={f} x1={18} x2={width} y1={PLOT_H * f + 0.5} y2={PLOT_H * f + 0.5} className="stroke-zinc-200 dark:stroke-white/10" strokeWidth={1} />
          ))}
          <line x1={0} x2={width} y1={PLOT_H - 0.5} y2={PLOT_H - 0.5} className="stroke-zinc-300 dark:stroke-white/20" strokeWidth={1} />
          {days.map((d, i) => {
            const h = d.value > 0 ? Math.max(2, (d.value / ceiling) * PLOT_H) : 0;
            const x = i * slot + (slot - barW) / 2;
            return (
              <g key={d.day}>
                {h > 0 && (
                  <path
                    d={barPath(x, barW, h)}
                    className={cx(active === i ? "fill-indigo-400 dark:fill-indigo-300" : "fill-indigo-600 dark:fill-indigo-500")}
                  />
                )}
                {/* The whole column is the hit target, not just the painted bar. */}
                <rect x={i * slot} y={0} width={slot} height={PLOT_H} fill="transparent" onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)} />
              </g>
            );
          })}
        </svg>
        {peak >= 0 && active === null && (
          <span
            className="pointer-events-none absolute -translate-x-1/2 text-[11px] font-medium tabular-nums text-zinc-700 dark:text-zinc-200"
            style={{ left: (peak + 0.5) * slot, top: Math.max(0, PLOT_H - (max / ceiling) * PLOT_H - 16) }}
            aria-hidden
          >
            {days[peak]!.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
          </span>
        )}
        {data && sum === 0 && (
          <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-zinc-500 dark:text-zinc-400">
            None in the last {days.length} days
          </span>
        )}
        {shown && active !== null && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs shadow-lg dark:border-white/10 dark:bg-zinc-900"
            style={{ left: Math.min(Math.max((active + 0.5) * slot, 60), width - 60) }}
            aria-hidden
          >
            <strong className="font-semibold tabular-nums">{unit(shown.value)}</strong>
            <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">{shortDay(shown.day)}</span>
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {shown ? `${shortDay(shown.day)}: ${unit(shown.value)}` : ""}
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400" aria-hidden>
        <span>{days[0] ? shortDay(days[0].day) : ""}</span>
        <span>Today</span>
      </div>
      <details className="mt-1 text-xs">
        <summary className={cx("cursor-pointer select-none text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100", focusRing)}>
          Show the numbers
        </summary>
        <table className="mt-1 w-full text-left">
          <thead className="text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-0.5 font-medium">Day</th>
              <th className="py-0.5 text-right font-medium">{title.replace(/ per day$/, "")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <td className="py-0.5">{shortDay(d.day)}</td>
                <td className="py-0.5 text-right">{d.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

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
