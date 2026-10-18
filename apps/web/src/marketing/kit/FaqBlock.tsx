import { Link } from "react-router-dom";
import { ChevronDown, cx, focusRing } from "@orbit/ui";
import type { Faq } from "../../../worker/faqs.js";
import { CONTACT_PAGE } from "../../lib/contact";
import { Section, SectionIntro } from "../primitives";

/**
 * A product page's questions, open one at a time. The words come from worker/faqs.js, the one list the page's FAQPage
 * structured data is made from too (worker/site.js), so the markup always states exactly what the page shows (D67):
 * plain text, no links inside an answer.
 */
export function FaqBlock({ id, title = "Questions people ask first.", items }: { id: string; title?: string; items: readonly Faq[] }) {
  return (
    <Section id="faq" labelledBy={id} band>
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionIntro id={id} eyebrow="Questions" title={title} />
          <p className="mt-5 text-[0.9375rem] text-zinc-600 dark:text-zinc-400">
            Something else?{" "}
            <Link to={CONTACT_PAGE} className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
              Ask the Orbit team
            </Link>
            .
          </p>
        </div>
        <div className="mk-divide border-y mk-line lg:col-span-8">
          {items.map(([q, a]) => (
            <details key={q} className="group">
              <summary
                className={cx(
                  "flex min-h-14 cursor-pointer list-none items-center gap-4 rounded-lg py-4 text-[0.9375rem] font-medium text-zinc-950 dark:text-white [&::-webkit-details-marker]:hidden",
                  focusRing,
                )}
              >
                <span className="flex-1">{q}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-quick group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="pb-5 pr-8 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-300">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
