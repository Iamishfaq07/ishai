import type { OfferMarket } from "@orbit/types";
import { money, placeOnRange } from "./model";

/**
 * The market for a role as one bar: the whole span of the posts' ranges, the middle half shaded, the median marked,
 * and (with `value`) where this offer's fixed pay lands. The same figures are in the text under it.
 */
export function MarketBar({ market: m, value, label = "This offer" }: { market: OfferMarket; value?: number; label?: string }) {
  const at = (v: number) => `${placeOnRange(v, m.low, m.high)}%`;
  return (
    <figure>
      <div className="relative h-12" role="img"
           aria-label={`Market for ${m.scope}: middle half ${money(m.currency, m.p25)} to ${money(m.currency, m.p75)}, median ${money(m.currency, m.median)}${value !== undefined ? `; ${label.toLowerCase()} ${money(m.currency, value)}` : ""}`}>
        <div className="absolute inset-x-0 top-5 h-2 rounded-full bg-zinc-500/15" />
        <div className="absolute top-5 h-2 rounded-full bg-indigo-500/40 dark:bg-indigo-400/40" style={{ left: at(m.p25), width: `calc(${at(m.p75)} - ${at(m.p25)})` }} />
        <div className="absolute top-4 h-4 w-0.5 bg-indigo-600 dark:bg-indigo-300" style={{ left: at(m.median) }} />
        {value !== undefined && (
          <div className="absolute top-0 -translate-x-1/2 text-center" style={{ left: at(value) }}>
            <span className="block whitespace-nowrap rounded bg-zinc-900 px-1.5 text-[10px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">{label}</span>
            <span className="mx-auto mt-0.5 block h-4 w-2.5 rounded-sm bg-zinc-900 ring-2 ring-white dark:bg-zinc-100 dark:ring-zinc-900" />
          </div>
        )}
      </div>
      <figcaption className="mt-1 flex justify-between text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        <span>{money(m.currency, m.low)}</span>
        <span>
          Middle half {money(m.currency, m.p25)}–{money(m.currency, m.p75)} · median {money(m.currency, m.median)} · {m.count} posts, {m.scope}
        </span>
        <span>{money(m.currency, m.high)}</span>
      </figcaption>
    </figure>
  );
}
