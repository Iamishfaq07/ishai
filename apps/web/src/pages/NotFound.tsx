import { Link } from "react-router-dom";
import { OrbitWordmark, cx, focusRing } from "@orbit/ui";
import { Footer } from "../components/Footer";
import { SiteMenu } from "../components/SiteMenu";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const link = cx(
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:border-zinc-300 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100",
  focusRing,
);

/** An address that isn't a page. The old behaviour sent people home with no explanation. */
export function NotFoundPage() {
  useDocumentTitle("Page not found", "That address isn't a page on Orbit. Go home, or open Resume AI, Jobs AI, or contact.");
  return (
    <div className="flex min-h-full flex-col overflow-x-clip">
      <header className="relative border-b border-zinc-200/70 bg-white dark:border-white/5 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className={cx("shrink-0 rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={26} />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <SiteMenu />
            <Link to="/register" className={cx(link, "border-transparent bg-indigo-600 text-white hover:bg-indigo-500")}>
              Start free
            </Link>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16">
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">404</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">This page isn't here</h1>
        <p className="mt-2 text-base text-zinc-600 dark:text-zinc-300">
          The link may be old, or the address was typed wrong.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link to="/" className={link}>Go home</Link>
          <Link to="/resume-ai" className={link}>Resume AI</Link>
          <Link to="/jobs" className={link}>Jobs AI</Link>
          <Link to="/contact" className={link}>Contact</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
