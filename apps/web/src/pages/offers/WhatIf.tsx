import { useEffect, useRef, useState } from "react";
import type { JobOfferRecord, OfferScenario, OfferScenarioInput } from "@orbit/types";
import { Spot, RotateCcw, cx, focusRing } from "@orbit/ui";
import { Card } from "../../components/ui";
import { api } from "../../lib/api";
import { useCountry } from "../../lib/country";
import { errorText } from "../../lib/format";
import { capital, money, offerTerms } from "./model";

const START: Required<Omit<OfferScenarioInput, "joining_bonus" | "pf">> = { fixed_change_pct: 0, variable_payout_pct: 100, equity_value_pct: 100 };

/**
 * What if: try a raise on the fixed pay, a smaller variable payout, a different joining bonus or what the equity turns
 * out to be worth, and see the first year and (in India) each month's in-hand pay next to the offer. Nothing is saved.
 */
export function WhatIf({ offer: o }: { offer: JobOfferRecord }) {
  const terms = offerTerms(useCountry());
  const [input, setInput] = useState({ ...START, joining_bonus: o.joining_bonus });
  const [result, setResult] = useState<OfferScenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Asked again a moment after the last change (sliders move in many small steps).
  useEffect(() => {
    const n = ++seq.current;
    const t = window.setTimeout(() => {
      api
        .offerScenario(o.id, input)
        .then((r) => n === seq.current && (setResult(r), setError(null)))
        .catch((err: unknown) => n === seq.current && setError(errorText(err)));
    }, 200);
    return () => window.clearTimeout(t);
  }, [o.id, input]);

  const changed = input.fixed_change_pct !== 0 || input.variable_payout_pct !== 100 || input.equity_value_pct !== 100 || input.joining_bonus !== o.joining_bonus;
  const m = (v: number | null | undefined, exact = false) => (v == null ? "–" : money(o.currency, v, exact));
  const diff = (a: number | null | undefined, b: number | null | undefined, exact = false) => {
    if (a == null || b == null || a === b) return null;
    const d = b - a;
    return <span className={cx("ml-1.5 text-xs font-medium", d > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>{d > 0 ? "+" : "−"}{money(o.currency, Math.abs(d), exact)}</span>;
  };
  const rows: Array<{ label: string; key: keyof OfferScenario["offer"]; show: boolean }> = [
    { label: `${terms.fixed} a year`, key: "fixed", show: true },
    { label: `${capital(terms.bonusWord)}, as paid out`, key: "variable", show: o.variable > 0 },
    { label: terms.joining, key: "joining_bonus", show: true },
    { label: "Equity a year", key: "equity_per_year", show: o.equity_per_year > 0 },
    { label: "First year in all", key: "first_year", show: true },
    { label: "In your account each month", key: "monthly_in_hand", show: o.currency === "INR" },
  ];

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-3 font-display text-base font-semibold"><Spot kind="whatif" />What if</h2>
        {changed && (
          <button
            type="button"
            onClick={() => setInput({ ...START, joining_bonus: o.joining_bonus })}
            className={cx("inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Back to the offer
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">Try a counter-offer or a bad year for {terms.bonusPay}. Nothing here is saved.</p>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Slider
            label={terms.fixed}
            value={input.fixed_change_pct}
            min={-30}
            max={50}
            step={1}
            text={`${input.fixed_change_pct > 0 ? "+" : ""}${input.fixed_change_pct}%`}
            onChange={(v) => setInput((i) => ({ ...i, fixed_change_pct: v }))}
          />
          {o.variable > 0 && (
            <Slider
              label={`${capital(terms.bonusWord)} paid out`}
              value={input.variable_payout_pct}
              min={0}
              max={150}
              step={5}
              text={`${input.variable_payout_pct}%`}
              onChange={(v) => setInput((i) => ({ ...i, variable_payout_pct: v }))}
            />
          )}
          {o.equity_per_year > 0 && (
            <Slider
              label="Equity worth"
              value={input.equity_value_pct}
              min={0}
              max={300}
              step={10}
              text={`${input.equity_value_pct}% of the offer's value`}
              onChange={(v) => setInput((i) => ({ ...i, equity_value_pct: v }))}
            />
          )}
          <Slider
            label={terms.joining}
            value={input.joining_bonus}
            min={0}
            max={Math.max(o.joining_bonus * 3, Math.round(o.fixed * 0.3))}
            step={Math.max(1000, Math.round(o.fixed / 200 / 1000) * 1000)}
            text={money(o.currency, input.joining_bonus)}
            onChange={(v) => setInput((i) => ({ ...i, joining_bonus: v }))}
          />
        </div>
        <div aria-live="polite">
          {error ? (
            <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="pb-2 font-medium" />
                  <th scope="col" className="pb-2 text-right font-medium">The offer</th>
                  <th scope="col" className="pb-2 text-right font-medium">What if</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-white/10">
                {rows.filter((r) => r.show).map((r) => (
                  <tr key={r.key} className={r.key === "first_year" || r.key === "monthly_in_hand" ? "font-semibold" : undefined}>
                    <th scope="row" className="py-2 text-left font-normal text-zinc-600 dark:text-zinc-300">{r.label}</th>
                    <td className="py-2 text-right tabular-nums">{m(result?.offer[r.key], r.key === "monthly_in_hand")}</td>
                    <td className="py-2 text-right tabular-nums">
                      {m(result?.scenario[r.key], r.key === "monthly_in_hand")}
                      {diff(result?.offer[r.key], result?.scenario[r.key], r.key === "monthly_in_hand")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result && (
            <details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              <summary className={cx("tap-y cursor-pointer rounded", focusRing)}>Assumptions</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {result.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>
    </Card>
  );
}

function Slider({ label, value, min, max, step, text, onChange }: { label: string; value: number; min: number; max: number; step: number; text: string; onChange: (v: number) => void }) {
  const id = `whatif-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{text}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={text} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-indigo-500 coarse:h-11" />
    </div>
  );
}
