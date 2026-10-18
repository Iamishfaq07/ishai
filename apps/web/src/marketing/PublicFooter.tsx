import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Monitor, MoonStar, Sun, cx, focusRing } from "@orbit/ui";
import { CONTACT_PAGE, POLICY_LINKS, SUPPORT_EMAIL, SUPPORT_WHATSAPP, USE_WHERE_ALLOWED } from "../lib/contact";
import { useIndia } from "../lib/country";
import { useTheme, type ThemePref } from "../lib/theme";
import { BrandLogo } from "./BrandLogo";
import { kashsecUrl } from "../pages/learn/links";
import { SITE_LINKS, siteProducts } from "./catalog";
import { Container } from "./primitives";

const link = cx(
  "inline-flex min-h-8 items-center rounded text-sm text-zinc-600 transition-colors duration-quick hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white",
  focusRing,
);

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">{title}</h2>
      <ul className="mt-3 space-y-1">{children}</ul>
    </nav>
  );
}

/** Light, dark, or the device's own: the same choice as Settings → Appearance, kept on this device. */
function ThemeSwitch() {
  const [pref, setPref] = useTheme();
  const options: Array<[ThemePref, string, typeof Sun]> = [
    ["system", "Use the device's theme", Monitor],
    ["light", "Light theme", Sun],
    ["dark", "Dark theme", MoonStar],
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border mk-line p-0.5">
      {options.map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          onClick={() => setPref(value)}
          className={cx(
            "grid h-7 w-8 place-items-center rounded-md text-zinc-500 transition-colors duration-quick hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
            pref === value && "bg-zinc-900/[0.06] text-zinc-950 dark:bg-white/10 dark:text-white",
            focusRing,
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/**
 * The public site's footer: what Orbit is, the products, the company's pages and the policies, then the honest line
 * about where it may be used, the theme switch and the year. Signed in, the app has its own one-line footer.
 */
export function PublicFooter({ className }: { className?: string }) {
  const india = useIndia();
  const products = siteProducts(india);
  return (
    <footer className={cx("border-t mk-line mk-canvas", className)}>
      <Container className="grid gap-10 py-14 sm:py-16 md:grid-cols-12">
        <div className="md:col-span-4">
          <Link to="/" className={cx("-ml-1 inline-flex rounded-lg p-1", focusRing)} aria-label="Orbit home">
            <BrandLogo height={24} decorative />
          </Link>
          <p className="mt-4 max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
            The AI career suite: practise interviews, fix your resume, find jobs and get help in the interview, with one account.
          </p>
          <div className="mt-4 flex flex-col items-start">
            {SUPPORT_EMAIL && (
              <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>
                {SUPPORT_EMAIL}
              </a>
            )}
            {SUPPORT_WHATSAPP && (
              <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} className={link}>
                WhatsApp
              </a>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 md:col-span-8">
          <Column title="Products">
            {products.map((p) => (
              <li key={p.id}>
                <Link to={p.href} className={link}>
                  {p.name}
                </Link>
              </li>
            ))}
          </Column>
          <Column title="Interview guides">
            <li>
              <Link to={SITE_LINKS.companies} className={link}>
                Company interview guides
              </Link>
            </li>
            <li>
              <Link to={SITE_LINKS.roles} className={link}>
                Interview guides by role
              </Link>
            </li>
            <li>
              <Link to={SITE_LINKS.warmup} className={link}>
                Free practice question
              </Link>
            </li>
          </Column>
          <Column title="Orbit">
            <li>
              <Link to={SITE_LINKS.pricing} className={link}>
                Pricing
              </Link>
            </li>
            <li>
              <Link to={SITE_LINKS.security} className={link}>
                Security and privacy
              </Link>
            </li>
            <li>
              <Link to={SITE_LINKS.howItWorks} className={link}>
                How Orbit works
              </Link>
            </li>
            <li>
              <Link to={SITE_LINKS.faq} className={link}>
                Questions
              </Link>
            </li>
            <li>
              <Link to={CONTACT_PAGE} className={link}>
                Contact us
              </Link>
            </li>
            <li>
              <a href={kashsecUrl("footer")} target="_blank" rel="noopener" className={link}>
                KashSec Academy (free)
                <span className="sr-only"> (opens KashSec in a new tab)</span>
              </a>
            </li>
          </Column>
          <Column title="Policies">
            {POLICY_LINKS.map(({ href, label }) => (
              <li key={href}>
                <a href={href} className={link}>
                  {label === "Refunds" ? "Refund policy" : label === "Privacy" ? "Privacy policy" : label === "Cookies" ? "Cookie policy" : "Terms of use"}
                </a>
              </li>
            ))}
          </Column>
        </div>
      </Container>
      <div className="border-t mk-line">
        <Container className="flex flex-col gap-4 py-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between dark:text-zinc-400">
          <p className="max-w-xl">{USE_WHERE_ALLOWED}</p>
          <div className="flex items-center gap-4">
            <ThemeSwitch />
            <p>© {new Date().getFullYear()} Orbit</p>
          </div>
        </Container>
      </div>
    </footer>
  );
}
