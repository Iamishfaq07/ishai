import type { ReactNode } from "react";
import { cx } from "@orbit/ui";
import { PublicFooter } from "./PublicFooter";
import { PublicHeader } from "./PublicHeader";
import { useSiteScope } from "./useSiteScope";

/**
 * The frame of every public page (the front page, the product pages, Contact, How Orbit works, the 404, the warm-up,
 * and any new public page such as /companies or /roles): skip link, the shared header, the page, the shared footer,
 * and the front door's look (html.site). Pages put their sections in `children`, built from marketing/primitives.
 *
 * - `authState`: where sign-in and sign-up come back to (`{ from: "/resume-ai" }`).
 * - `context`: a short label after the logo on wide screens ("Contact").
 * - `actions`: replaces Sign in / Start free in the header.
 */
export function PublicLayout({
  children,
  authState,
  context,
  actions,
  className,
  footer = true,
}: {
  children: ReactNode;
  authState?: { from: string };
  context?: ReactNode;
  actions?: ReactNode;
  className?: string;
  footer?: boolean;
}) {
  useSiteScope();
  return (
    <div className="flex min-h-full flex-col overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-zinc-950 focus:shadow-lg dark:focus:bg-zinc-900 dark:focus:text-white"
      >
        Skip to content
      </a>
      <PublicHeader authState={authState} context={context} actions={actions} />
      <main id="main" tabIndex={-1} className={cx("flex-1 outline-none", className)}>
        {children}
      </main>
      {footer && <PublicFooter />}
    </div>
  );
}
