import type { ComponentType, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, CountUp, Minus, Reveal, cx } from "@orbit/ui";
import { PRODUCT_TILE, type SiteProduct } from "../catalog";
import { CtaBand, inkButton } from "../ProductPage";
import { ArrowLink, Container, IconTile, Section, SectionIntro } from "../primitives";

/**
 * The product pages' section kit (DECISIONS D79; DESIGN.md "Product pages"): the parts a product page is built from,
 * in the front door's grid and type. Every number on them is a fact the code or the server stands behind (no ratings,
 * user counts or invented results), and every picture is the product's own UI.
 */

// ─── Facts ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Fact {
  /** A number counts up the first time it's in view (Full motion); text is shown as it is. */
  value: number | string;
  /** After a counted number ("%", "+"). */
  suffix?: string;
  label: string;
}

/** A band of true product facts under the hero ("100 points", "10 templates"): never a rating or a user count. */
export function FactsBand({ facts, label }: { facts: Fact[]; label: string }) {
  return (
    <section aria-label={label} className="border-y mk-line mk-band">
      <Container>
        <dl className={cx("grid grid-cols-2 gap-x-4 gap-y-8 py-10 sm:gap-x-8 sm:py-12", facts.length > 3 ? "lg:grid-cols-4" : "sm:grid-cols-3")}>
          {facts.map((f) => (
            <div key={f.label} className="flex min-w-0 flex-col-reverse gap-1.5 border-l mk-line pl-4 sm:pl-6">
              <dt className="text-xs leading-snug text-zinc-600 sm:text-sm dark:text-zinc-400">{f.label}</dt>
              <dd className="stat-value text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl dark:text-white">
                {typeof f.value === "number" ? <CountUp to={f.value} suffix={f.suffix} /> : f.value}
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}

// ─── Three steps ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface StepUi {
  title: string;
  text: ReactNode;
  /** The step's own small render of the product (it plays when it scrolls into view). */
  ui: ReactNode;
}

/** "Three steps to…": each step a card with its own small animated piece of the product above its words. */
export function StepsWithUI({ id, eyebrow, title, lead, steps, band = false }: { id: string; eyebrow?: string; title: string; lead?: ReactNode; steps: StepUi[]; band?: boolean }) {
  return (
    <Section labelledBy={id} band={band}>
      <SectionIntro id={id} eyebrow={eyebrow} title={title} lead={lead} />
      <Reveal as="ol" stagger className="mt-14 grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex min-w-0 flex-col">
            <div className="flex h-56 items-center justify-center overflow-hidden rounded-2xl border mk-line mk-band p-4 sm:p-5">{s.ui}</div>
            <p className="mt-6 text-sm font-medium tabular-nums text-zinc-500 dark:text-zinc-400" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </p>
            <h3 className="mk-h3 mt-2 text-zinc-950 dark:text-white">
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{s.text}</p>
          </li>
        ))}
      </Reveal>
    </Section>
  );
}

// ─── The toolkit ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Tool {
  title: string;
  text: ReactNode;
  /** Its mark: a lucide icon on the site's tile (IconTile). */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** A working piece of the product: typing, bars that fill, chips that light, a ring that counts. */
  widget: ReactNode;
  /** Two columns wide: the whole row at md (two columns), two of the three at lg. */
  wide?: boolean;
}

/**
 * "The whole toolkit": cards that are small working pieces of the product, each with what it does. A wide card spans
 * from md up so the grid has no empty cell at either column count: five cards with one wide fill 2 + 2 + 2 and 3 + 3
 * (the prerender test checks every product page's).
 */
export function ToolkitGrid({ id, eyebrow, title, lead, tools, band = false, children }: {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  tools: Tool[];
  band?: boolean;
  children?: ReactNode;
}) {
  return (
    <Section id={id.replace(/-title$/, "")} labelledBy={id} band={band}>
      <SectionIntro id={id} eyebrow={eyebrow} title={title} lead={lead} />
      <ul className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <li key={t.title} className={cx("flex min-w-0 flex-col rounded-2xl border mk-line mk-surface p-5 sm:p-6", t.wide && "md:col-span-2")}>
            <div className="flex items-center gap-3">
              {t.icon && <IconTile icon={t.icon} />}
              <h3 className="text-base font-semibold text-zinc-950 dark:text-white">{t.title}</h3>
            </div>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{t.text}</p>
            <div className="mt-5 flex flex-1 flex-col justify-center overflow-hidden rounded-xl border mk-line mk-band p-3 sm:p-4">{t.widget}</div>
          </li>
        ))}
      </ul>
      {children}
    </Section>
  );
}

// ─── A fair comparison ─────────────────────────────────────────────────────────────────────────────────────────────

export interface Side {
  name: string;
  /** What it hands you, in two or three words ("Plain text", "Ready to send"). */
  tag: string;
  mark?: ReactNode;
  visual: ReactNode;
  lines: string[];
}

/** Two ways to do the same job, side by side and factual: what each hands you. No competitor is named or run down. */
export function ComparisonBlock({ id, eyebrow, title, lead, left, right, note }: { id: string; eyebrow?: string; title: ReactNode; lead?: ReactNode; left: Side; right: Side; note?: ReactNode }) {
  const side = (s: Side, ours: boolean) => (
    <div className={cx("flex min-w-0 flex-col rounded-2xl border mk-surface p-5 sm:p-6", ours ? "border-indigo-500/40 dark:border-indigo-300/30" : "mk-line")}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-base font-semibold text-zinc-950 dark:text-white">
          {s.mark}
          {s.name}
        </p>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{s.tag}</span>
      </div>
      <div className="mt-5 h-60 overflow-hidden rounded-xl border mk-line mk-band">{s.visual}</div>
      <ul className="mt-5 divide-y mk-line">
        {s.lines.map((l) => (
          <li key={l} className="flex items-start gap-3 py-3 text-[0.9375rem] text-zinc-700 dark:text-zinc-300">
            {ours ? (
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              </span>
            ) : (
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-500/10 text-zinc-500 dark:text-zinc-400">
                <Minus className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0">{l}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Section labelledBy={id} band>
      <SectionIntro id={id} eyebrow={eyebrow} title={title} lead={lead} center />
      <Reveal stagger className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-2">
        {side(left, false)}
        {side(right, true)}
      </Reveal>
      {note && <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-zinc-600 dark:text-zinc-400">{note}</p>}
    </Section>
  );
}

// ─── What comes next ───────────────────────────────────────────────────────────────────────────────────────────────

export interface Next {
  product: Pick<SiteProduct, "id" | "name"> & { icon: ComponentType<{ className?: string; strokeWidth?: number }> };
  title: string;
  text: ReactNode;
  to: string;
  cta: string;
}

/** "After the resume, the interview": the products that pick up where this one stops, from the same account. */
export function CrossSell({ id, eyebrow, title, lead, items }: { id: string; eyebrow?: string; title: string; lead?: ReactNode; items: Next[] }) {
  return (
    <Section labelledBy={id}>
      <SectionIntro id={id} eyebrow={eyebrow} title={title} lead={lead} />
      <Reveal as="ul" stagger className={cx("mt-14 grid gap-px overflow-hidden rounded-2xl border mk-line bg-[rgb(var(--site-line))]", items.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {items.map((n) => (
          <li key={n.to} className="flex flex-col mk-surface p-6 sm:p-8">
            <p className="flex items-center gap-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              <IconTile icon={n.product.icon} tone={PRODUCT_TILE[n.product.id]} size="sm" />
              {n.product.name}
            </p>
            <h3 className="mk-h3 mt-5 text-zinc-950 dark:text-white">{n.title}</h3>
            <p className="mt-2 flex-1 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{n.text}</p>
            <ArrowLink to={n.to} className="mt-5 self-start">
              {n.cta}
            </ArrowLink>
          </li>
        ))}
      </Reveal>
    </Section>
  );
}

// ─── The last word ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The closing ink panel with a two-tone title and the page's last action (the phones' sticky bar steps aside here). */
export function FinalCta({ id, title, text, primary, secondary, footnote, innerRef }: {
  id: string;
  title: [ReactNode, ReactNode];
  text: ReactNode;
  primary: { to: string; label: string; state?: unknown };
  secondary?: { to: string; label: string; state?: unknown };
  footnote?: ReactNode;
  innerRef?: Ref<HTMLElement>;
}) {
  return (
    <CtaBand
      id={id}
      innerRef={innerRef}
      title={
        <>
          {title[0]} <span className="block text-indigo-300">{title[1]}</span>
        </>
      }
      text={text}
      actions={
        <>
          <Link to={primary.to} state={primary.state} className={inkButton.primary}>
            {primary.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {secondary && (
            <Link to={secondary.to} state={secondary.state} className={inkButton.secondary}>
              {secondary.label}
            </Link>
          )}
        </>
      }
      footnote={footnote}
    />
  );
}
