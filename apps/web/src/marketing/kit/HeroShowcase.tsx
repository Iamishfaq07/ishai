import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, cx, focusRing } from "@orbit/ui";
import { PRODUCT_TILE, type SiteProduct } from "../catalog";
import { Container, Eyebrow, IconTile } from "../primitives";

/** Where a page sits, above its title: "Home / Resume AI" (the structured data says the same, worker/site.js). */
export function SiteCrumbs({ items, className }: { items: Array<{ label: string; to?: string }>; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cx("text-sm text-zinc-600 dark:text-zinc-400", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.to ? (
              <Link to={item.to} className={cx("rounded hover:text-zinc-900 hover:underline dark:hover:text-white", focusRing)}>
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-zinc-800 dark:text-zinc-200">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A product page's first screen (the section kit, DECISIONS D79): breadcrumbs, the product's mark, a two-tone
 * headline (ink, then the accent: solid colour, never a gradient), one lead, the actions, what's free said plainly,
 * and on the right the product itself, drawn from its real components and playing its one sequence. The page's only
 * h1. `ctas` marks the buttons for the phones' sticky bar (it comes in once they scroll away).
 */
export function HeroShowcase({
  product,
  title,
  lead,
  actions,
  note,
  honest,
  visual,
  ctas,
}: {
  product: Pick<SiteProduct, "id" | "name" | "icon">;
  /** [the ink part, the accent part]. */
  title: [ReactNode, ReactNode];
  lead: ReactNode;
  actions: ReactNode;
  /** Under the actions: what's free, from the server where it can be. */
  note?: ReactNode;
  /** The honest line about where it may be used, when the product needs one. */
  honest?: ReactNode;
  visual: ReactNode;
  ctas?: Ref<HTMLDivElement>;
}) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate">
      <div className="mk-hero-detail" aria-hidden="true" />
      <Container className="pt-6 sm:pt-8">
        <SiteCrumbs items={[{ label: "Home", to: "/" }, { label: product.name }]} />
      </Container>
      <Container className="grid grid-cols-1 items-center gap-12 pb-16 pt-8 sm:pt-10 lg:grid-cols-12 lg:gap-10 lg:pb-24 lg:pt-12">
        <div className="min-w-0 lg:col-span-6">
          <Eyebrow plain>
            <IconTile icon={product.icon} tone={PRODUCT_TILE[product.id]} size="sm" />
            Orbit {product.name}
          </Eyebrow>
          <h1 id="hero-title" className="mk-display mt-6 text-zinc-950 dark:text-white">
            <span className="block">{title[0]}</span> <span className="block text-indigo-700 dark:text-indigo-300">{title[1]}</span>
          </h1>
          <p className="mk-lead mt-6 max-w-xl text-zinc-600 dark:text-zinc-300">{lead}</p>
          <div ref={ctas} className="mt-8 flex flex-col gap-3 sm:flex-row">
            {actions}
          </div>
          {note && <div className="mt-5 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">{note}</div>}
          {honest && (
            <p className="mt-6 flex max-w-xl items-start gap-2.5 border-t mk-line pt-5 text-[0.8125rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {honest}
            </p>
          )}
        </div>
        <div className="min-w-0 lg:col-span-6 lg:pl-4">{visual}</div>
      </Container>
    </section>
  );
}
