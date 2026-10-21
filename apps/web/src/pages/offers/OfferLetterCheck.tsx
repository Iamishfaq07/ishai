import { useDeferredValue, useMemo, useState } from "react";
import { CircleAlert, FileText, Info, cx } from "@orbit/ui";
import { Card, Input, Textarea } from "../../components/ui";
import { CopyBlock } from "../kit/CopyBlock";
import { checkOffer, questionsEmail } from "./offerClauses";

/**
 * Offers → "Offer letter check" (offerClauses.ts): paste the letter or contract and see the clauses worth a second
 * look, each quoted with what it usually means and what to ask. The text is read in the browser and not saved.
 */
export function OfferLetterCheck() {
  const [text, setText] = useState("");
  const [company, setCompany] = useState("");
  const deferred = useDeferredValue(text);
  const clauses = useMemo(() => checkOffer(deferred), [deferred]);
  const has = deferred.trim().length > 80;

  return <Card>
    <h2 className="flex items-center gap-3 font-display text-lg font-semibold"><FileText className="h-5 w-5 text-indigo-600" aria-hidden /> Offer letter check</h2>
    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Paste the offer letter or contract. Orbit points out bonds, non-competes, clawbacks and other clauses worth asking about before you sign. Read in your browser, not saved.</p>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <Input aria-label="Company (optional)" placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
        <Textarea aria-label="Offer letter text" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full text of the offer letter or employment agreement…" />
      </div>
      <div className="space-y-3" aria-live="polite">
        {!has ? <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-white/5 dark:text-zinc-400">Clauses appear here as you paste.</p>
          : !clauses.length ? <p className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">None of the common surprise clauses found. Still read it in full, especially pay, role and start date.</p>
          : <>
            <ul className="space-y-2">{clauses.map((c) => <li key={c.id} className={cx("rounded-xl border p-3 text-sm motion-safe:animate-fade-up", c.weight === "check" ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-200 dark:border-white/10")}>
              <p className="flex items-center gap-2 font-semibold">{c.weight === "check" ? <CircleAlert className="h-4 w-4 text-amber-600" aria-hidden /> : <Info className="h-4 w-4 text-indigo-600" aria-hidden />}{c.label}{c.amount && <span className="rounded bg-amber-500/15 px-1.5 text-xs font-medium">{c.amount}</span>}</p>
              <p className="mt-1 text-xs italic text-zinc-600 dark:text-zinc-400">“{c.quote.length > 220 ? `${c.quote.slice(0, 220)}…` : c.quote}”</p>
              <p className="mt-1.5">{c.means}</p>
              <p className="mt-1 text-zinc-700 dark:text-zinc-300"><span className="font-medium">Ask:</span> {c.ask}</p>
            </li>)}</ul>
            <CopyBlock label="Questions for HR" hint="Paste into an email; edit to your words" text={questionsEmail(clauses, company)} />
          </>}
      </div>
    </div>
    <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">A reading aid, not legal advice. For a large bond or a strict non-compete, a lawyer's read is worth it.</p>
  </Card>;
}
