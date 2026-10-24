import { useMemo, useState } from "react";
import type { JobOfferRecord } from "@orbit/types";
import { Scale, cx, focusRing, readJSON, safeLocal } from "@orbit/ui";
import { Card } from "../../components/ui";

/**
 * Offer decision matrix (the weighted-scoring method career coaches and decision templates use): pay is scored from
 * each offer's first-year value; everything else the candidate rates 1–5 and weights by how much it matters. The
 * result is a ranking with the reason, not a recommendation. Ratings stay on this device.
 */

export const CRITERIA = [
  { id: "pay", label: "Pay", hint: "From each offer's first-year value" },
  { id: "growth", label: "Growth & promotion" },
  { id: "learning", label: "Learning & skills" },
  { id: "balance", label: "Work-life balance" },
  { id: "team", label: "Manager & team" },
  { id: "location", label: "Location & commute" },
  { id: "stability", label: "Company stability" },
] as const;
type Criterion = typeof CRITERIA[number]["id"];
type Ratings = Record<string, Partial<Record<Criterion, number>>>;
type Weights = Record<Criterion, number>;

const KEY = "orbit.offers.matrix";
const DEFAULT_WEIGHTS: Weights = { pay: 5, growth: 4, learning: 3, balance: 4, team: 4, location: 2, stability: 3 };
interface Saved { weights: Weights; ratings: Ratings }
const isSaved = (v: unknown): v is Saved => typeof v === "object" && v !== null && "weights" in v && "ratings" in v;

/** Pay as 1–5: the highest first-year value scores 5, the rest in proportion (same currency only). */
export function payScores(offers: JobOfferRecord[]): Record<string, number> {
  const max = Math.max(...offers.map((o) => o.first_year), 1);
  return Object.fromEntries(offers.map((o) => [o.id, Math.max(1, Math.round((o.first_year / max) * 50) / 10)]));
}

export function rank(offers: JobOfferRecord[], weights: Weights, ratings: Ratings) {
  const pay = payScores(offers);
  const total = CRITERIA.reduce((n, c) => n + weights[c.id], 0) || 1;
  return offers.map((o) => {
    const parts = CRITERIA.map((c) => {
      const score = c.id === "pay" ? pay[o.id]! : ratings[o.id]?.[c.id] ?? 3;
      return { id: c.id, label: c.label, score, weighted: (score * weights[c.id]) / total };
    });
    const value = parts.reduce((n, p) => n + p.weighted, 0);
    const best = [...parts].filter((p) => weights[p.id as Criterion] >= 3).sort((a, b) => b.score - a.score)[0];
    return { offer: o, value: Math.round(value * 20), best };
  }).sort((a, b) => b.value - a.value);
}

export function DecisionMatrix({ offers }: { offers: JobOfferRecord[] }) {
  const [saved, setSaved] = useState<Saved>(() => readJSON(safeLocal, KEY, { weights: DEFAULT_WEIGHTS, ratings: {} }, isSaved));
  const update = (next: Saved) => { setSaved(next); safeLocal.setItem(KEY, JSON.stringify(next)); };
  const sameCurrency = new Set(offers.map((o) => o.currency)).size === 1;
  const ranked = useMemo(() => rank(offers, { ...DEFAULT_WEIGHTS, ...saved.weights }, saved.ratings), [offers, saved]);
  const weights = { ...DEFAULT_WEIGHTS, ...saved.weights };

  return <Card>
    <h2 className="flex items-center gap-3 font-display text-lg font-semibold"><Scale className="h-5 w-5 text-indigo-600" aria-hidden /> Decision matrix</h2>
    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Rate each offer 1–5 on what matters to you and set how much each thing matters. Pay is scored for you. Your ratings stay on this device.</p>
    {!sameCurrency && <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">These offers are in different currencies, so pay is left out of the score.</p>}

    <div className="mt-4 overflow-x-auto" role="region" aria-label="Ratings (scrolls sideways)" tabIndex={0}>
      <table className="w-full min-w-[36rem] text-sm">
        <thead><tr className="text-left text-xs text-zinc-600 dark:text-zinc-400">
          <th scope="col" className="pb-2 font-medium">What matters</th>
          <th scope="col" className="pb-2 font-medium">How much (1–5)</th>
          {offers.map((o) => <th key={o.id} scope="col" className="pb-2 font-medium">{o.company}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-white/10">{CRITERIA.map((c) => <tr key={c.id}>
          <th scope="row" className="py-2 pr-3 text-left font-medium">{c.label}{"hint" in c && <span className="block text-xs font-normal text-zinc-500">{c.hint}</span>}</th>
          <td className="py-2 pr-3"><select aria-label={`How much ${c.label} matters`} value={c.id === "pay" && !sameCurrency ? 0 : weights[c.id]} disabled={c.id === "pay" && !sameCurrency}
            onChange={(e) => update({ ...saved, weights: { ...weights, [c.id]: Number(e.target.value) } })}
            className={cx("min-h-9 rounded-lg border border-zinc-300 bg-white px-2 dark:border-white/15 dark:bg-zinc-900", focusRing)}>
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? "Ignore" : n}</option>)}</select></td>
          {offers.map((o) => <td key={o.id} className="py-2 pr-3">{c.id === "pay"
            ? <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{sameCurrency ? payScores(offers)[o.id] : "–"}</span>
            : <div role="radiogroup" aria-label={`${c.label} at ${o.company}`} className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => {
              const on = (saved.ratings[o.id]?.[c.id] ?? 3) === n;
              return <button key={n} type="button" role="radio" aria-checked={on} aria-label={`${n}`}
                onClick={() => update({ ...saved, ratings: { ...saved.ratings, [o.id]: { ...saved.ratings[o.id], [c.id]: n } } })}
                className={cx("h-8 w-8 rounded-md text-xs font-semibold ring-1 motion-safe:transition-colors", on ? "bg-indigo-600 text-white ring-indigo-600" : "ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5", focusRing)}>{n}</button>;
            })}</div>}</td>)}
        </tr>)}</tbody>
      </table>
    </div>

    <h3 className="mt-6 font-semibold">How they rank for you</h3>
    <ol className="mt-3 space-y-3">{(sameCurrency ? ranked : rank(offers, { ...weights, pay: 0 }, saved.ratings)).map((r, i) => <li key={r.offer.id}>
      <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">{i + 1}. {r.offer.company}{r.offer.role ? ` · ${r.offer.role}` : ""}</span><span className="tabular-nums font-semibold">{r.value}/100</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10"><div className={cx("h-full rounded-full motion-safe:transition-[width] motion-safe:duration-page", i === 0 ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${r.value}%` }} /></div>
      {r.best && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Strongest on {r.best.label.toLowerCase()} ({r.best.score}/5).</p>}
    </li>)}</ol>
    <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">A way to see your own priorities side by side, not advice on which to accept.</p>
  </Card>;
}
