import { useEffect, useState } from "react";
import type { FeedbackReport } from "@orbit/types";
import { FEEDBACK_REASONS } from "./AnswerRating";
import { cx, focusRing } from "./cx";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

function GroupTable({ title, rows }: { title: string; rows: FeedbackReport["by_type"] }) {
  if (!rows.length) return null;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-zinc-500">
          <th className="pb-2 font-medium">{title}</th>
          <th className="pb-2 text-right font-medium">👍</th>
          <th className="pb-2 text-right font-medium">👎</th>
          <th className="pb-2 text-right font-medium">Satisfied</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((g) => (
          <tr key={g.key}>
            <td className="py-1.5 capitalize">{g.key.replace(/_/g, " ")}</td>
            <td className="py-1.5 text-right tabular-nums">{g.up}</td>
            <td className="py-1.5 text-right tabular-nums">{g.down}</td>
            <td className="py-1.5 text-right tabular-nums">{pct(g.up / (g.up + g.down))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Admin diagnostics: how users rate live answers, and why they 👎 them (counts only, no answer content). */
export function FeedbackDiagnostics({ load }: { load: (days: number) => Promise<FeedbackReport> }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<FeedbackReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    load(days)
      .then((r) => !cancelled && setReport(r))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [days, load]);

  const total = report ? report.up + report.down : 0;
  const maxReason = Math.max(1, ...Object.values(report?.reasons ?? {}));
  return (
    <section aria-label="Answer ratings">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Answer ratings</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">👍/👎 from users on live answers{report ? ` · ${total} rated` : ""}.</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Period"
          className={cx("rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700", focusRing)}
        >
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {!error && report && total === 0 && <p className="text-sm text-zinc-500">No rated answers in this period yet.</p>}
      {report && total > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-zinc-500/5 p-3 ring-1 ring-zinc-200 dark:ring-white/[0.06]">
              <p className="text-xs text-zinc-500">Satisfied</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{pct(report.satisfaction)}</p>
              <p className="text-xs text-zinc-500 tabular-nums">
                {report.up} 👍 · {report.down} 👎
              </p>
            </div>
            <div className="rounded-xl bg-zinc-500/5 p-3 ring-1 ring-zinc-200 dark:ring-white/[0.06]">
              <p className="text-xs text-zinc-500">Answers rated</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{pct(report.rated_share)}</p>
              <p className="text-xs text-zinc-500">of completed answers</p>
            </div>
          </div>
          {Object.keys(report.reasons).length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-zinc-500">Why 👎</h3>
              <ul className="space-y-1.5">
                {FEEDBACK_REASONS.filter((r) => report.reasons[r.key]).map((r) => {
                  const n = report.reasons[r.key] ?? 0;
                  return (
                    <li key={r.key} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-2 text-sm">
                      <span>{r.label}</span>
                      <span className="h-2 rounded-full bg-zinc-500/10">
                        <span
                          className="block h-2 rounded-full bg-indigo-500"
                          style={{ width: `${Math.max(4, (n / maxReason) * 100)}%` }}
                        />
                      </span>
                      <span className="text-right tabular-nums">{n}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <GroupTable title="Question type" rows={report.by_type} />
          <GroupTable title="Model" rows={report.by_model} />
        </div>
      )}
    </section>
  );
}
