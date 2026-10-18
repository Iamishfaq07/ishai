import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { JobOfferRecord, OfferInput } from "@orbit/types";
import { Spot, CircleAlert, CopyButton, CosmicEmptyState, Mic, PenLine, Sparkles, Trash2, LoadGate, confirmDialog, cx } from "@orbit/ui";
import { BackLink } from "../../components/BackLink";
import { Button, Card, ErrorNote, IconButton } from "../../components/ui";
import { api } from "../../lib/api";
import { useCountry } from "../../lib/country";
import { errorText } from "../../lib/format";
import { useAsync } from "../../lib/useAsync";
import { MarketBar } from "./MarketBar";
import { OfferForm } from "./OfferForm";
import { WhatIf } from "./WhatIf";
import { POSITION_TEXT, POSITION_TONE } from "./Offers";
import { OFFERS_HOME, inputOf, money, offerTerms, practiceRequest } from "./model";

/** One offer: what it's made of, what reaches the account, where it sits in the market, and the negotiation. */
export function OfferDetailPage() {
  const { offerId = "" } = useParams();
  const offers = useAsync(() => api.offers(), [], "offers");
  const offer = offers.data?.find((o) => o.id === offerId);
  const replace = (next: JobOfferRecord) => offers.setData((prev) => (prev ?? []).map((o) => (o.id === next.id ? next : o)));
  return (
    <>
      <BackLink to={OFFERS_HOME} className="mb-4">All offers</BackLink>
      <LoadGate loading={offers.loading && !offers.data} variant="card" count={3} label="Getting the offer">
        {offers.error && !offers.data ? (
          <ErrorNote onRetry={offers.reload}>{errorText(offers.error)}</ErrorNote>
        ) : offer ? (
          <Detail offer={offer} onChange={replace} onDeleted={() => offers.setData((prev) => (prev ?? []).filter((o) => o.id !== offer.id))} />
        ) : (
          <CosmicEmptyState variant="no-results" title="That offer isn't here" body="It may have been deleted." action={<Link to={OFFERS_HOME} className="text-indigo-700 underline dark:text-indigo-300">See your offers</Link>} />
        )}
      </LoadGate>
    </>
  );
}

function Detail({ offer: o, onChange, onDeleted }: { offer: JobOfferRecord; onChange: (o: JobOfferRecord) => void; onDeleted: () => void }) {
  const country = useCountry();
  const terms = offerTerms(country);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setErrorAt(key);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const save = (input: OfferInput) => run("save", async () => {
    onChange(await api.updateOffer(o.id, input));
    setEditing(false);
  });
  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete the ${o.company} offer?`, body: "Its figures and plan go. This can't be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await run("delete", async () => {
      await api.deleteOffer(o.id);
      onDeleted();
      navigate(OFFERS_HOME);
    });
  };
  const plan = () => run("plan", async () => onChange(await api.offerPlan(o.id)));
  const practise = () => run("practise", async () => {
    const session = await api.createSession(practiceRequest(o, country));
    navigate(`/live/${session.id}`, { state: { systemAudio: false } });
  });

  if (editing) {
    return <OfferForm initial={inputOf(o)} busy={busy === "save"} error={error} onSave={(i) => void save(i)} onCancel={() => setEditing(false)} />;
  }
  const c = o.currency;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{o.company}</h1>
          <p className="text-zinc-500 dark:text-zinc-400">{[o.role, o.city].filter(Boolean).join(" · ")}{o.deadline ? ` · decide by ${new Date(o.deadline).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}><PenLine className="h-4 w-4" /> Edit</Button>
          <IconButton icon={Trash2} disabled={busy === "delete"} onClick={() => void remove()} label="Delete this offer" className="text-zinc-500 hover:!bg-rose-500/10 hover:!text-rose-700 dark:hover:!text-rose-300" />
        </div>
      </header>
      {error && errorAt !== "plan" && errorAt !== "practise" && <ErrorNote>{error}</ErrorNote>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-3 font-display text-base font-semibold"><Spot kind="parts" />What it's made of</h2>
          <dl className="space-y-1.5 text-sm">
            {([[`${terms.fixed} a year`, o.fixed], [terms.variableYear, o.variable], [`${terms.joining} (once)`, o.joining_bonus], ["Equity a year", o.equity_per_year], ["Other a year", o.other]] as const)
              .filter(([, v]) => v > 0)
              .map(([label, v]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-zinc-600 dark:text-zinc-300">{label}</dt>
                  <dd className="tabular-nums">{money(c, v, true)}</dd>
                </div>
              ))}
            <div className="flex justify-between gap-3 border-t border-zinc-200 pt-1.5 font-semibold dark:border-white/10">
              <dt>First year, all in</dt>
              <dd className="tabular-nums">{money(c, o.first_year, true)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-600 dark:text-zinc-300">Every year after</dt>
              <dd className="tabular-nums">{money(c, o.yearly, true)}</dd>
            </div>
          </dl>
          {o.variable > 0 && o.variable / (o.fixed + o.variable) > 0.2 && (
            <p className="mt-3 flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Over a fifth of the pay is {terms.bonusWord}: ask how much was actually paid out last year.
            </p>
          )}
        </Card>

        {o.take_home && (
          <Card>
            <h2 className="flex items-center gap-3 font-display text-base font-semibold"><Spot kind="wallet" />In your account each month</h2>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{money(c, o.take_home.monthly, true)}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">An estimate, from the fixed pay. The variable comes once a year: about {money(c, o.take_home.variable_after_tax, true)} after tax.</p>
            <dl className="mt-3 space-y-1 text-sm">
              {([["Income tax a year", o.take_home.yearly_tax], ["Your PF a year (yours, saved)", o.take_home.employee_pf], ["Employer PF and gratuity in the CTC", o.take_home.employer_costs], ["Professional tax a year", o.take_home.professional_tax]] as const).map(([label, v]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-zinc-600 dark:text-zinc-300">{label}</dt>
                  <dd className="tabular-nums">{money(c, v, true)}</dd>
                </div>
              ))}
            </dl>
            <details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              <summary className="tap-y cursor-pointer">How this is worked out</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {o.take_home.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
              <p className="mt-1">Your offer letter's own split of basic pay and allowances, or the old regime with HRA, can change it.</p>
            </details>
          </Card>
        )}
      </div>

      <WhatIf offer={o} />

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-3 font-display text-base font-semibold"><Spot kind="market" />Against the market</h2>
          {o.position && <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", POSITION_TONE[o.position])}>{POSITION_TEXT[o.position]}</span>}
        </div>
        {o.market ? (
          <MarketBar market={o.market} value={o.fixed} label="This offer" />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Too few job posts for "{o.role}" showed pay to compare. A more common title (as job posts write it) may find more.</p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-3 font-display text-base font-semibold"><Spot kind="negotiate" />Your negotiation</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">What to ask for and why, what to say, and the email. From the offer, the market and your resume.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(!o.plan || o.plan_stale) && (
              <Button disabled={busy === "plan"} onClick={() => void plan()}>
                <Sparkles className="h-4 w-4" /> {busy === "plan" ? "Planning…" : o.plan ? "Update the plan" : "Make my plan"}
              </Button>
            )}
            <Button variant="secondary" disabled={busy === "practise"} onClick={() => void practise()}>
              <Mic className="h-4 w-4" /> {busy === "practise" ? "Starting…" : "Practise the call"}
            </Button>
          </div>
        </div>
        {error && (errorAt === "plan" || errorAt === "practise") && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {o.plan_stale && <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">The figures changed since this plan was made.</p>}
        {o.plan && <PlanView offer={o} />}
      </Card>
    </div>
  );
}

function PlanView({ offer: o }: { offer: JobOfferRecord }) {
  const p = o.plan!;
  const raise = p.ask - o.fixed;
  const terms = offerTerms(useCountry());
  return (
    <div className="mt-4 space-y-5">
      <div className="rounded-xl bg-indigo-500/[0.07] p-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Ask for</p>
        <p className="font-display text-3xl font-semibold tabular-nums">{money(o.currency, p.ask)} <span className="text-base font-normal text-zinc-500">{terms.fixedWord} a year</span></p>
        {raise > 0 && <p className="text-sm text-zinc-600 dark:text-zinc-300">{money(o.currency, raise)} ({Math.round((raise / o.fixed) * 100)}%) more than offered. {p.ask_why}</p>}
      </div>
      {p.reasons.length > 0 && <Section title="Your case">{p.reasons}</Section>}
      <div>
        <h3 className="mb-1 text-sm font-semibold">On the call</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {p.call_script.map((line) => <li key={line}>{line}</li>)}
        </ol>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">The email after</h3>
          <CopyButton variant="ghost" text={`Subject: ${p.email.subject}\n\n${p.email.body}`} />
        </div>
        <div className="whitespace-pre-wrap rounded-lg border border-zinc-200 p-3 text-sm dark:border-white/10">
          <p className="mb-2 font-medium">Subject: {p.email.subject}</p>
          {p.email.body}
        </div>
      </div>
      {p.questions.length > 0 && <Section title="Ask before you accept">{p.questions}</Section>}
      {p.watch_outs.length > 0 && <Section title="Check in this offer" tone="warn">{p.watch_outs}</Section>}
    </div>
  );
}

function Section({ title, children, tone }: { title: string; children: string[]; tone?: "warn" }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <ul className={cx("list-disc space-y-1 pl-5 text-sm", tone === "warn" && "text-amber-900 dark:text-amber-100")}>
        {children.map((x) => <li key={x}>{x}</li>)}
      </ul>
    </div>
  );
}
