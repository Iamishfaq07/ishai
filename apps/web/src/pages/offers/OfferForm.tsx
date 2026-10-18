import { useState, type FormEvent } from "react";
import type { OfferInput, OfferPf } from "@orbit/types";
import { currencyFor, sampleCity } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, Select, Textarea } from "../../components/ui";
import { useCountry } from "../../lib/country";
import { money, offerTerms, unitFor } from "./model";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"];

/**
 * A figure typed in lakhs (India) or thousands, as offers are written: "24.5" → 24,50,000. The hint always says the
 * unit (or reads the figure back): an equity or allowance figure typed in full would otherwise be taken as lakhs.
 * `once`: paid once (a joining bonus), so not "a year".
 */
function Amount({ id, label, value, currency, onChange, hint, once = false }: { id: string; label: string; value: number; currency: string; onChange: (v: number) => void; hint?: string; once?: boolean }) {
  const { label: unit, factor } = unitFor(currency);
  const [text, setText] = useState(value ? String(Math.round((value / factor) * 100) / 100) : "");
  const reading = value ? money(currency, value, true) : `In ${once ? unit.replace(/ a year$/, "") : unit}`;
  return (
    <Field label={label} htmlFor={id} hint={hint ? `${hint}. ${reading}` : reading}>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder="0"
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, "");
          setText(raw);
          const n = Number.parseFloat(raw);
          onChange(Number.isFinite(n) ? Math.round(n * factor) : 0);
        }}
      />
    </Field>
  );
}

/** Add or change an offer: the figures as the offer letter gives them, and how its PF works (India). */
export function OfferForm({ initial, busy, error, onSave, onCancel }: { initial: OfferInput; busy: boolean; error: string | null; onSave: (o: OfferInput) => void; onCancel: () => void }) {
  const [o, setO] = useState<OfferInput>(initial);
  // Worded and ordered for where the user applies: their currency first, their city as the example.
  const country = useCountry();
  const terms = offerTerms(country);
  const own = currencyFor(country);
  const currencies = [...new Set([own, ...CURRENCIES, o.currency])];
  const city = sampleCity(country);
  const set = <K extends keyof OfferInput>(key: K, value: OfferInput[K]) => setO((prev) => ({ ...prev, [key]: value }));
  const india = o.currency === "INR";
  const ready = o.company.trim() && o.role.trim() && o.fixed > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onSave({ ...o, company: o.company.trim(), role: o.role.trim(), city: o.city.trim() });
  };
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Company" htmlFor="of-company">
            <Input id="of-company" value={o.company} maxLength={200} onChange={(e) => set("company", e.target.value)} />
          </Field>
          <Field label="Role" htmlFor="of-role">
            <Input id="of-role" value={o.role} maxLength={200} placeholder="e.g. Backend Engineer" onChange={(e) => set("role", e.target.value)} />
          </Field>
          <Field label="City" htmlFor="of-city">
            <Input id="of-city" value={o.city} maxLength={120} placeholder={city ? `e.g. ${city}` : undefined} onChange={(e) => set("city", e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency" htmlFor="of-currency">
            <Select id="of-currency" value={o.currency} onChange={(e) => set("currency", e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Amount key={`fixed-${o.currency}`} id="of-fixed" label={`${terms.fixed} a year`} value={o.fixed} currency={o.currency} onChange={(v) => set("fixed", v)} />
          <Amount key={`var-${o.currency}`} id="of-variable" label={terms.variableForm} value={o.variable} currency={o.currency} onChange={(v) => set("variable", v)} />
          <Amount key={`jb-${o.currency}`} id="of-joining" label={`${terms.joining} (once)`} value={o.joining_bonus} currency={o.currency} onChange={(v) => set("joining_bonus", v)} once />
          <Amount key={`eq-${o.currency}`} id="of-equity" label="Equity a year" value={o.equity_per_year} currency={o.currency} onChange={(v) => set("equity_per_year", v)}
                  hint="The grant's value divided by its vesting years, as the offer states it" />
          <Amount key={`ot-${o.currency}`} id="of-other" label="Other pay a year" value={o.other} currency={o.currency} onChange={(v) => set("other", v)}
                  hint="Allowances, retention, relocation" />
        </div>
        {india && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="PF" htmlFor="of-pf" hint="Most offers take PF on ₹15,000 a month; some on the whole basic pay.">
              <Select id="of-pf" value={o.pf} onChange={(e) => set("pf", e.target.value as OfferPf)}>
                <option value="capped">On ₹15,000 a month (₹1,800 each)</option>
                <option value="full">12% of the whole basic pay</option>
                <option value="none">No PF</option>
              </Select>
            </Field>
            <label className="flex items-start gap-2 pt-7 text-sm">
              <input type="checkbox" checked={o.employer_costs_in_ctc} onChange={(e) => set("employer_costs_in_ctc", e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span>
                The CTC includes the employer's PF and gratuity
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">Most Indian offers count them, though they never reach your account.</span>
              </span>
            </label>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Decide by" htmlFor="of-deadline">
            <Input id="of-deadline" type="date" value={o.deadline ? o.deadline.slice(0, 10) : ""} onChange={(e) => set("deadline", e.target.value ? `${e.target.value}T12:00:00Z` : null)} />
          </Field>
          <Field label="Status" htmlFor="of-status">
            <Select id="of-status" value={o.status} onChange={(e) => set("status", e.target.value as OfferInput["status"])}>
              <option value="considering">Considering</option>
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
            </Select>
          </Field>
        </div>
        <Field label="Notes" htmlFor="of-notes" hint="Anything the plan should know: other interviews, what matters to you, what the recruiter said.">
          <Textarea id="of-notes" rows={3} maxLength={2000} value={o.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy} loadingText="Saving…" disabled={!ready}>Save offer</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
