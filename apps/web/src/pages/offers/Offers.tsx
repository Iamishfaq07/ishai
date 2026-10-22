import { SpotArt } from "../../components/SpotArt";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { JobOfferRecord, OfferInput, OfferMarket } from "@orbit/types";
import { Spot, ArrowRight, BadgeIndianRupee, CosmicEmptyState, Banknote, Plus, Reveal, Skeleton, celebrate, currencyFor, cx, focusRing, isIndia } from "@orbit/ui";
import { Stat } from "../prepare/parts";
import { Button, Card, ErrorNote, Field, Input, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { useAsync, useSettledOnce } from "../../lib/useAsync";
import { useCountry } from "../../lib/country";
import { jobPath } from "../jobs/paths";
import { OfferForm } from "./OfferForm";
import { DecisionMatrix } from "./DecisionMatrix";
import { OfferLetterCheck } from "./OfferLetterCheck";
import { ResignPlanner } from "./ResignPlanner";
import { SalaryScripts } from "./SalaryScripts";
import { MarketBar } from "./MarketBar";
import { compareRows, emptyOffer, money, offerPath, offerTerms } from "./model";

export const POSITION_TEXT = { below: "Below the market's middle", within: "In the market's middle", above: "Above the market's middle" } as const;
export const POSITION_TONE = {
  below: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  within: "bg-sky-500/10 text-sky-800 dark:text-sky-200",
  above: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
} as const;

/**
 * Offers: your offers, what each puts in your account every month (India; elsewhere what each is worth in its first
 * year), where each sits in the market for the role, side by side, and a plan to negotiate each (OfferDetail). The
 * market is read from the pay ranges in job posts.
 */
export function OffersPage() {
  const country = useCountry();
  const india = isIndia(country);
  const offers = useAsync(() => api.offers(), [], "offers");
  const shown = useSettledOnce(offers);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = offers.data ?? [];
  const Icon = country === "IN" ? BadgeIndianRupee : Banknote;

  const add = async (o: OfferInput) => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.addOffer(o);
      offers.setData((prev) => [made, ...(prev ?? [])]);
      setAdding(false);
      if (!list.length) celebrate("first-offer", { message: "Your first offer is in. Open it to see what it's worth and what to ask for." });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader art={<SpotArt kind="offer" />} eyebrow="Offers & decisions"
        icon={Icon}
        title="Offers"
        subtitle={
          india
            ? "What an offer really pays each month, how it compares with the market, and a plan to ask for more."
            : "What an offer is worth in its first year, how it compares with the market, and a plan to ask for more. Monthly take-home after tax is India-only for now."
        }
        actions={shown && !adding && list.length > 0 ? (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add an offer
          </Button>
        ) : undefined}
      />
      {adding && (
        <div className="mb-6">
          <OfferForm initial={emptyOffer(currencyFor(country))} busy={busy} error={error} onSave={(o) => void add(o)} onCancel={() => setAdding(false)} />
        </div>
      )}
      {/* Until the offers are in, one placeholder for the list and the check below it, swapped for both at once (no
          minimum skeleton time): drawn as they arrived, the list pushed the pay check down (CLS 0.45 on a phone). */}
      {!shown ? (
        <Skeleton variant="card" count={2} label="Getting your offers" className="min-h-[60vh]" />
      ) : (
      <>
        {offers.error && !offers.data ? (
          <ErrorNote onRetry={offers.reload}>{errorText(offers.error)}</ErrorNote>
        ) : list.length === 0 && !adding ? (
          <CosmicEmptyState
            variant="offers"
            title="Got an offer? Add it here"
            body={
              india
                ? "Orbit works out what reaches your account each month, shows where it sits in the market for the role, and plans what to ask for. Then practise the call."
                : "Orbit adds up what it's worth in the first year, shows where it sits in the market for the role, and plans what to ask for. Then practise the call."
            }
            action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add your first offer</Button>}
          />
        ) : (
          <div className="space-y-6">
            <Reveal stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Offers" value={list.length} hint="Recorded by you" />
              <Stat label="Above market" value={list.filter((o) => o.position === "above").length} hint="Above the middle of the role's range" />
              <Stat label="Plans ready" value={list.filter((o) => o.plan && !o.plan_stale).length} hint="With a negotiation plan" />
              <Stat label="Still deciding" value={list.filter((o) => o.status === "considering").length} hint="Waiting on your answer" />
            </Reveal>
            <Reveal as="ul" stagger className="grid gap-3 md:grid-cols-2">
              {list.map((o) => (
                <li key={o.id}>
                  <OfferCard offer={o} best={bestId(list) === o.id} />
                </li>
              ))}
            </Reveal>
            {list.length > 1 && <Compare offers={list} />}
            {list.length > 1 && <DecisionMatrix offers={list} />}
          </div>
        )}
        <PayCheck />
        <div className="mt-6 space-y-6"><OfferLetterCheck /><SalaryScripts /><ResignPlanner /></div>
      </>
      )}
    </>
  );
}

/** The offer worth the most in its first year, when there are two or more in one currency. */
export function bestId(offers: JobOfferRecord[]): string | null {
  if (offers.length < 2 || new Set(offers.map((o) => o.currency)).size > 1) return null;
  return offers.reduce((a, b) => (b.first_year > a.first_year ? b : a)).id;
}

function OfferCard({ offer: o, best = false }: { offer: JobOfferRecord; best?: boolean }) {
  const terms = offerTerms(useCountry());
  return (
    <Link to={offerPath(o.id)} className={cx("block rounded-2xl", focusRing)}>
      <Card className={cx("h-full transition-[box-shadow,transform] hover:shadow-md motion-safe:hover:-translate-y-0.5", best && "ring-2 ring-emerald-500/40")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold">{o.company}</p>
            <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{[o.role, o.city].filter(Boolean).join(" · ")}</p>
          </div>
          {o.status !== "considering" && (
            <span className="shrink-0 rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-medium capitalize">{o.status}</span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{terms.fixedShort} a year</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{money(o.currency, o.fixed)}</dd>
          </div>
          {o.take_home ? (
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">In your account monthly</dt>
              <dd className="font-display text-xl font-semibold tabular-nums">{money(o.currency, o.take_home.monthly, true)}</dd>
            </div>
          ) : (
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">First year, all in</dt>
              <dd className="font-display text-xl font-semibold tabular-nums">{money(o.currency, o.first_year)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {best && <span className="rounded-full bg-emerald-600 px-2 py-0.5 font-medium text-white">Highest first year</span>}
          {o.position && <span className={cx("rounded-full px-2 py-0.5 font-medium", POSITION_TONE[o.position])}>{POSITION_TEXT[o.position]}</span>}
          {o.plan && !o.plan_stale && <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium text-indigo-800 dark:text-indigo-200">Plan: ask {money(o.currency, o.plan.ask)}</span>}
          <span className="ml-auto inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400">
            Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </div>
      </Card>
    </Link>
  );
}

/** The offers side by side: every figure each gives, the best on each row marked. */
function Compare({ offers }: { offers: JobOfferRecord[] }) {
  const currencies = new Set(offers.map((o) => o.currency));
  const rows = compareRows(offers, useCountry());
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-3 font-display text-lg font-semibold">
        <Spot kind="compare" /> Side by side
      </h2>
      {currencies.size > 1 && <p className="mb-2 text-sm text-amber-800 dark:text-amber-200">These offers are in different currencies, so the best on each row isn't marked.</p>}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Offers side by side (scrolls sideways)">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col" className="pb-2 font-medium text-zinc-500 dark:text-zinc-400"><span className="sr-only">Figure</span></th>
              {offers.map((o) => (
                <th key={o.id} scope="col" className="pb-2 text-right font-semibold">{o.company}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-zinc-200 dark:border-white/10">
                <th scope="row" className="py-2 pr-3 text-left font-normal text-zinc-600 dark:text-zinc-300">{r.label}</th>
                {r.values.map((v, i) => {
                  const best = currencies.size === 1 && r.best === i;
                  return (
                    <td key={offers[i]!.id} className={cx("py-2 text-right tabular-nums", best && "font-semibold text-emerald-700 dark:text-emerald-300")}>
                      {v === null ? "–" : money(offers[i]!.currency, v, r.label === "In the bank each month")}
                      {best && <span className="sr-only"> (best)</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** What a role pays: the middle of the pay ranges in recent job posts, and which posts. */
function PayCheck() {
  const [role, setRole] = useState("");
  const [city, setCity] = useState("");
  const [result, setResult] = useState<OfferMarket | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.payCheck(role.trim(), city.trim()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mt-8">
      <h2 className="flex items-center gap-3 font-display text-lg font-semibold">
        <Spot kind="rolepay" /> What does a role pay?
      </h2>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">From the pay ranges in recent job posts Orbit has read. Posts that don't show pay aren't counted.</p>
      <form onSubmit={(e) => void check(e)} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Field label="Role" htmlFor="pc-role">
          <Input id="pc-role" value={role} maxLength={120} placeholder="e.g. Product Designer" onChange={(e) => setRole(e.target.value)} />
        </Field>
        <Field label="City (optional)" htmlFor="pc-city">
          <Input id="pc-city" value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" loading={busy} loadingText="Checking…" disabled={role.trim().length < 2} disabledReason="Add the role first">Check pay</Button>
      </form>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {result === null && <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">Too few posts for that role showed pay to say. Try a broader title, or no city.</p>}
      {result && (
        <div className="mt-4 space-y-3">
          <MarketBar market={result} />
          <ul className="space-y-1 text-sm">
            {result.samples.map((s) => (
              <li key={s.listing_id} className="flex flex-wrap justify-between gap-x-3">
                <Link to={jobPath(s.listing_id)} className={cx("min-w-0 truncate text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
                  {s.title} · {s.company}{s.city ? ` · ${s.city}` : ""}
                </Link>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">{s.salary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
