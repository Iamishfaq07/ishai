import type { ComponentType, ReactNode, Ref } from "react";
import { Reveal, cx } from "@orbit/ui";
import { PRODUCT_TILE, type SiteProduct } from "./catalog";
import { Container, Eyebrow, IconTile, Section, SectionIntro } from "./primitives";

/**
 * The template of a public product page (Resume AI, Jobs AI, and any product that gets one): a hero with the product's
 * mark, its promise and one primary action beside a real picture of it; a grid of what it does; the page's own
 * sections; and a closing ink panel. Same grid and type as the front page.
 */

export function ProductHero({
  product,
  title,
  lead,
  detail,
  actions,
  note,
  visual,
}: {
  product: Pick<SiteProduct, "id" | "name" | "icon">;
  title: ReactNode;
  lead: ReactNode;
  /** A second, quieter paragraph. */
  detail?: ReactNode;
  actions: ReactNode;
  /** Under the actions: what's free. */
  note?: ReactNode;
  visual: ReactNode;
}) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate">
      <div className="mk-hero-detail" aria-hidden="true" />
      <Container className="grid grid-cols-1 items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-12 lg:gap-10 lg:pb-24 lg:pt-20">
        <div className="min-w-0 lg:col-span-6">
          <Eyebrow plain>
            <IconTile icon={product.icon} tone={PRODUCT_TILE[product.id]} size="sm" />
            Orbit {product.name}
          </Eyebrow>
          <h1 id="hero-title" className="mk-display mt-6 text-zinc-950 dark:text-white">
            {title}
          </h1>
          <p className="mk-lead mt-6 max-w-xl text-zinc-600 dark:text-zinc-300">{lead}</p>
          {detail && <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{detail}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">{actions}</div>
          {note && <div className="mt-5 max-w-xl">{note}</div>}
        </div>
        <div className="min-w-0 lg:col-span-6 lg:pl-4">{visual}</div>
      </Container>
    </section>
  );
}

export interface Feature {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  text: ReactNode;
}

/** What a product does: icon, name and a line each, in a hairline grid. */
export function FeatureGrid({ id, eyebrow, title, lead, features, band = false }: { id: string; eyebrow?: string; title: string; lead?: ReactNode; features: Feature[]; band?: boolean }) {
  const cols = features.length % 3 === 0 && features.length % 4 !== 0 ? "lg:grid-cols-3" : "lg:grid-cols-4";
  return (
    <Section labelledBy={id} band={band}>
      <SectionIntro id={id} eyebrow={eyebrow} title={title} lead={lead} />
      <Reveal as="ul" stagger className={cx("mt-14 grid gap-px overflow-hidden rounded-2xl border mk-line bg-[rgb(var(--site-line))] sm:grid-cols-2", cols)}>
        {features.map(({ icon, title: t, text }) => (
          <li key={t} className="flex flex-col mk-surface p-6">
            <IconTile icon={icon} />
            <h3 className="mt-5 text-base font-semibold text-zinc-950 dark:text-white">{t}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
          </li>
        ))}
      </Reveal>
    </Section>
  );
}

/** The closing panel: solid ink in light mode, a raised surface in dark mode, white type, the page's one last action. */
export function CtaBand({ id, title, text, actions, footnote, innerRef }: {
  id: string;
  title: ReactNode;
  text: ReactNode;
  actions: ReactNode;
  footnote?: ReactNode;
  innerRef?: Ref<HTMLElement>;
}) {
  return (
    <section ref={innerRef} aria-labelledby={id} className="py-16 sm:py-24">
      <Container>
        <Reveal className="relative overflow-hidden rounded-3xl bg-zinc-950 px-6 py-14 text-center text-white sm:px-12 sm:py-20 dark:border dark:border-[rgb(var(--site-line))] dark:bg-[rgb(var(--site-surface))]">
          <h2 id={id} className="mk-h2 mx-auto max-w-2xl text-white">
            {title}
          </h2>
          <p className="mk-lead mx-auto mt-5 max-w-xl text-white/75">{text}</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">{actions}</div>
          {footnote && <div className="mx-auto mt-6 max-w-xl text-sm text-white/60">{footnote}</div>}
        </Reveal>
      </Container>
    </section>
  );
}

/** The two buttons of the ink panel: solid white (the main one) and a white outline. */
export const inkButton = {
  primary: cx(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-base font-medium text-zinc-950 transition-colors duration-quick hover:bg-zinc-100",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
  ),
  secondary: cx(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/25 px-6 text-base font-medium text-white transition-colors duration-quick hover:bg-white/10",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
  ),
};
