import { useEffect, useState } from "react";
import type { LatencyMetric, LatencyReport } from "@orbit/types";
import { cx, focusRing } from "./cx";

const ROWS: Array<{ key: LatencyMetric; label: string; hint: string }> = [
  { key: "first_token_after_speech", label: "Speech end → first AI word", hint: "What you feel in an interview" },
  { key: "question_after_speech", label: "Speech end → question detected", hint: "Includes the Wait before answering setting" },
  { key: "first_token_after_question", label: "Question → first AI word", hint: "Retrieval + AI model" },
  { key: "stt_final", label: "Speech end → final transcript", hint: "Transcription" },
  { key: "stt_first_partial", label: "Speech start → first words shown", hint: "Transcription" },
];

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);

/** Admin diagnostics: live-latency percentiles across recent sessions (timings only, no content). */
export function LatencyDiagnostics({ load }: { load: (days: number) => Promise<LatencyReport> }) {
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<LatencyReport | null>(null);
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

  const rows = ROWS.filter((r) => report?.metrics[r.key]);
  return (
    <section aria-label="Latency diagnostics">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Latency</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Measured from the interviewer&apos;s actual speech{report ? ` · ${report.sessions} sessions` : ""}.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Period"
          className={cx("rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700", focusRing)}
        >
          {[1, 7, 30].map((d) => (
            <option key={d} value={d}>
              Last {d === 1 ? "day" : `${d} days`}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {!error && report && rows.length === 0 && (
        <p className="text-sm text-zinc-500">No live sessions with timing data in this period yet.</p>
      )}
      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="pb-2 font-medium">Leg</th>
              <th className="pb-2 text-right font-medium">Typical (p50)</th>
              <th className="pb-2 text-right font-medium">Slow (p95)</th>
              <th className="pb-2 text-right font-medium">Samples</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => {
              const m = report!.metrics[r.key]!;
              return (
                <tr key={r.key}>
                  <td className="py-2">
                    {r.label}
                    <div className="text-xs text-zinc-500">{r.hint}</div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmt(m.p50)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(m.p95)}</td>
                  <td className="py-2 text-right tabular-nums text-zinc-500">{m.n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
