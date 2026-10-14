import { useEffect, useState } from "react";
import type { CostReport } from "@orbit/types";
import { cx, focusRing } from "./cx";

const usd = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "—" : v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(digits)}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800" title={hint}>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** A model's cache health: green from half its prompt tokens cached, amber from a fifth, red below. */
export function cacheTone(ratio: number | null): { label: string; className: string } {
  if (ratio === null) return { label: "no prompts", className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" };
  if (ratio >= 0.5) return { label: "healthy", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" };
  if (ratio >= 0.2) return { label: "fair", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" };
  return { label: "low", className: "bg-rose-500/15 text-rose-800 dark:text-rose-300" };
}

/**
 * Two rings: the outer is the share of prompt tokens served from DeepSeek's cache, the inner what that saved as a
 * share of what the AI would have cost without it. Both draw in from empty (base.css stops it with reduced motion).
 */
function CacheGauge({ ratio, saved, spent }: { ratio: number | null; saved: number; spent: number }) {
  const savedShare = saved + spent > 0 ? saved / (saved + spent) : 0;
  const ring = (r: number, share: number, color: string, width: number) => {
    const length = 2 * Math.PI * r;
    return (
      <>
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth={width} />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - Math.min(1, Math.max(0, share)))}
          transform="rotate(-90 50 50)"
          className="gauge-draw"
          style={{ ["--gauge-len" as string]: `${length}` }}
        />
      </>
    );
  };
  return (
    <div className="flex items-center gap-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 text-zinc-500" role="img"
        aria-label={`Prompt cache: ${ratio === null ? "no data" : `${Math.round(ratio * 100)}% of prompt tokens`}, saved ${usd(saved)}`}>
        {ring(42, ratio ?? 0, "#22d3ee", 8)}
        {ring(29, savedShare, "#34d399", 7)}
        <text x="50" y="54" textAnchor="middle" className="fill-current text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
          {ratio === null ? "—" : `${Math.round(ratio * 100)}%`}
        </text>
      </svg>
      <dl className="space-y-1 text-xs">
        <div>
          <dt className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-cyan-400" aria-hidden /> Prompt cache hits
          </dt>
          <dd className="font-semibold tabular-nums">{ratio === null ? "—" : `${Math.round(ratio * 100)}% of prompt tokens`}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden /> Saved by the cache
          </dt>
          <dd className="font-semibold tabular-nums">
            {usd(saved)} <span className="font-normal text-zinc-500">({Math.round(savedShare * 100)}% of the uncached cost)</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Admin: what the AI and transcription providers cost (estimates; unpriced calls are counted, never $0). */
export function CostDashboard({ load }: { load: (days: number) => Promise<CostReport> }) {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<CostReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    load(days)
      .then((x) => !cancelled && setR(x))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [days, load]);

  return (
    <section aria-label="Cost dashboard">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Costs</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Estimated provider spend. No content is read.</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Period"
          className={cx("rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900", focusRing)}
        >
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {r && !r.has_data && <p className="text-sm text-zinc-500">No usage in this period yet.</p>}
      {r && r.has_data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Total" value={usd(r.totals.usd)} />
            <Stat label="AI (LLM)" value={usd(r.totals.llm_usd)} hint="DeepSeek + backup, from token counts" />
            <Stat label="Transcription" value={usd(r.totals.stt_usd)} hint={r.notes.stt} />
            <Stat label="Screenshots (vision)" value={usd(r.totals.vision_usd)} />
            <Stat label="Per live hour" value={usd(r.live.usd_per_hour)} hint={`${r.live.hours} live hours`} />
            <Stat label="Per session" value={usd(r.live.usd_per_session)} hint={`${r.live.sessions} sessions`} />
            <Stat
              label="Cache hit ratio"
              value={r.llm.cache_hit_ratio === null ? "—" : `${Math.round(r.llm.cache_hit_ratio * 100)}%`}
              hint="Share of prompt tokens served from DeepSeek's cache (billed cheaper)"
            />
            <Stat
              label="Tokens / answer"
              value={r.llm.tokens_per_answer.input === null ? "—" : `${r.llm.tokens_per_answer.input} in · ${r.llm.tokens_per_answer.output} out`}
            />
          </div>
          <CacheGauge ratio={r.llm.cache_hit_ratio} saved={r.llm.cache_saved_usd ?? 0} spent={r.totals.llm_usd} />
          {r.totals.unpriced_llm_requests > 0 && (
            <p role="status" className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
              {r.totals.unpriced_llm_requests} AI call{r.totals.unpriced_llm_requests === 1 ? "" : "s"} used a model with no
              configured price and {r.totals.unpriced_llm_requests === 1 ? "isn't" : "aren't"} in the totals. {r.notes.unpriced}
            </p>
          )}
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Cost by model</caption>
            <thead className="text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 font-medium">Model</th>
                <th className="py-1 text-right font-medium">Calls</th>
                <th className="py-1 text-right font-medium">Tokens in / out</th>
                <th className="py-1 text-right font-medium">Cache</th>
                <th className="py-1 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {r.llm.by_model.map((m) => (
                <tr key={`${m.provider}/${m.model}`} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1">
                    {m.provider} · {m.model}
                    {m.provider !== "deepseek" && m.provider !== "mock" && <span className="ml-1 text-zinc-500">(backup)</span>}
                  </td>
                  <td className="py-1 text-right">{m.requests}</td>
                  <td className="py-1 text-right">
                    {m.input_tokens.toLocaleString()} / {m.output_tokens.toLocaleString()}
                  </td>
                  <td className="py-1 text-right">
                    {(() => {
                      const ratio = m.input_tokens ? m.cached_input_tokens / m.input_tokens : null;
                      const tone = cacheTone(ratio);
                      return (
                        <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", tone.className)}>
                          {ratio === null ? "—" : `${Math.round(ratio * 100)}%`} {tone.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-1 text-right">
                    {usd(m.usd, 4)}
                    {m.unpriced > 0 && <span className="text-amber-700 dark:text-amber-300"> +{m.unpriced} unpriced</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.per_user.length > 0 && (
            <table className="w-full text-left text-xs">
              <caption className="mb-1 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">Top users</caption>
              <tbody className="tabular-nums">
                {r.per_user.slice(0, 5).map((u) => (
                  <tr key={u.user_id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="truncate py-1">{u.email ?? u.user_id}</td>
                    <td className="py-1 text-zinc-500">{u.plan}</td>
                    <td className="py-1 text-right">{usd(u.usd, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
