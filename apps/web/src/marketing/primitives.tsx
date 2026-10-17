import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, cx, focusRing } from "@orbit/ui";

/**
 * The front door's building blocks: one container width, one section rhythm, one way to introduce a section. Pages
 * compose these instead of spacing things by hand, so every public page keeps the same grid.
 */

/** The page grid: 72rem of content, 20 px gutters on phones, 32 px from `sm`. */
export function Container({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "header" | "footer" | "nav" }) {
  return <Tag className={cx("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>{children}</Tag>;
}

/** A section of a public page: 64 px of air on phones, 112 px on wide screens, a hairline above unless `flush`. */
export function Section({
  id,
  labelledBy,
  label,
  children,
  className,
  band = false,
  flush = false,
}: {
  id?: string;
  labelledBy?: string;
  label?: string;
  children: ReactNode;
  className?: string;
  /** The subtle alternate background (a band across the page). */
  band?: boolean;
  /** No hairline above (the first section, or one after a band). */
  flush?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      aria-label={label}
      className={cx("scroll-mt-20 py-16 sm:py-24 lg:py-28", band && "mk-band", !flush && !band && "border-t mk-line", className)}
    >
      <Container>{children}</Container>
    </section>
  );
}

/** The small line above a heading: sentence case, the accent (or a product's own colour), never tracked capitals. */
export function Eyebrow({ children, className, icon: Icon, plain = false }: { children: ReactNode; className?: string; icon?: ComponentType<{ className?: string }>; plain?: boolean }) {
  return (
    <p className={cx("flex items-center gap-2 text-sm font-medium", plain ? "text-zinc-700 dark:text-zinc-200" : "text-indigo-700 dark:text-indigo-300", className)}>
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {children}
    </p>
  );
}

/** A section's heading block: eyebrow, title (h2), one lead paragraph. `center` for full-width intros. */
export function SectionIntro({
  id,
  eyebrow,
  title,
  lead,
  center = false,
  className,
  children,
}: {
  id: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  center?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cx("max-w-3xl", center && "mx-auto text-center", className)}>
      {eyebrow && <Eyebrow className={cx("mb-4", center && "justify-center")}>{eyebrow}</Eyebrow>}
      <h2 id={id} className="mk-h2 text-zinc-950 dark:text-white">
        {title}
      </h2>
      {lead && <p className={cx("mk-lead mt-5 text-zinc-600 dark:text-zinc-300", center && "mx-auto")}>{lead}</p>}
      {children}
    </div>
  );
}

/** "Learn more →": a text link with an arrow that nudges on hover (Full motion). */
export function ArrowLink({ to, children, className, state }: { to: string; children: ReactNode; className?: string; state?: unknown }) {
  const external = /^https?:|^mailto:/.test(to) || to.endsWith(".html");
  const cls = cx(
    "group inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200",
    focusRing,
    className,
  );
  const body = (
    <>
      {children}
      <ArrowRight className="h-4 w-4 transition-transform duration-quick ease-standard motion-ok:group-hover:translate-x-0.5" aria-hidden="true" />
    </>
  );
  return external ? (
    <a href={to} className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to} state={state} className={cls}>
      {body}
    </Link>
  );
}

/** A list of what something does, each line with a quiet check. */
export function CheckList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cx("space-y-3 text-[0.9375rem] text-zinc-700 dark:text-zinc-300", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/15 dark:bg-indigo-400/10 dark:text-indigo-200 dark:ring-indigo-300/20">
            <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The site's icon style: a lucide icon (1.75 stroke) on a 40 px tile with a hairline ring, ink by default or a
 * product's own tint. Decorative: the words beside it say what it is.
 */
export function IconTile({ icon: Icon, tone, size = "md", className }: { icon: ComponentType<{ className?: string; strokeWidth?: number }>; tone?: string; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center ring-1 ring-inset",
        size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl",
        tone ?? "bg-zinc-100 text-zinc-700 ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10",
        className,
      )}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} strokeWidth={1.75} />
    </span>
  );
}
