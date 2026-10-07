import { Link } from "react-router-dom";
import { OrbitWordmark, cx, focusRing } from "@orbit/ui";
import { CONTACT_PAGE, POLICY_LINKS, USE_WHERE_ALLOWED } from "../lib/contact";

const link = cx(
  "inline-flex min-h-6 items-center rounded py-1 text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-white",
  focusRing,
);

/**
 * The public pages' footer (the front page and the product pages): the products, help and the policies. Signed in,
 * the layout has its own one-line footer (Help and the policies).
 */
export function Footer({ className }: { className?: string }) {
  return (
    <footer className={cx("border-t border-zinc-200/70 dark:border-white/5", className)}>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="max-w-xs">
          <Link to="/" className={cx("inline-flex rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={24} />
          </Link>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">Practise interviews, fix your resume and find jobs, with one account.</p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{USE_WHERE_ALLOWED}</p>
        </div>
        <nav aria-label="Products">
          <h2 className="font-display text-sm font-semibold">Products</h2>
          <ul className="mt-2 space-y-0.5">
            <li>
              <Link to="/#interview" className={link}>
                Interview copilot
              </Link>
            </li>
            <li>
              <Link to="/resume-ai" className={link}>
                Resume AI
              </Link>
            </li>
            <li>
              <Link to="/jobs" className={link}>
                Jobs AI
              </Link>
            </li>
            <li>
              <Link to="/warmup" className={link}>
                Free practice question
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Help">
          <h2 className="font-display text-sm font-semibold">Help</h2>
          <ul className="mt-2 space-y-0.5">
            <li>
              <Link to="/#pricing" className={link}>
                Pricing
              </Link>
            </li>
            <li>
              <Link to="/#faq" className={link}>
                Common questions
              </Link>
            </li>
            {CONTACT_PAGE && (
              <li>
                <a href={CONTACT_PAGE} className={link}>
                  Contact us
                </a>
              </li>
            )}
          </ul>
        </nav>
        <nav aria-label="Policies">
          <h2 className="font-display text-sm font-semibold">Policies</h2>
          <ul className="mt-2 space-y-0.5">
            {POLICY_LINKS.filter((l) => l.href !== CONTACT_PAGE).map(({ href, label }) => (
              <li key={href}>
                <a href={href} className={link}>
                  {label === "Refunds" ? "Refund policy" : label === "Privacy" ? "Privacy policy" : "Terms of use"}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
