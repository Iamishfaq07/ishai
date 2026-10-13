import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Keyboard, Mail, MessageCircle, Send, buttonClass, cx, focusRing, isMacPlatform } from "@orbit/ui";
import { displayAudioHelp } from "../lib/audio";
import { CONTACT_PAGE, POLICY_LINKS, SUPPORT_EMAIL, USE_WHERE_ALLOWED, mailLink, whatsappLink } from "../lib/contact";
import { useWelcomeGrant } from "../lib/welcome";
import { Sheet } from "./Sheet";

/**
 * Help, in the same place on every page (the account menu, the phone's "Me" tab, the footer, the search): how to
 * reach a person, short answers to what people ask most, the words Orbit uses, and the shortcuts. Its own chunk,
 * loaded the first time it opens.
 */

/** The words that trip people up, said plainly (the in-page tooltips come with the design layer's `Term`). */
const GLOSSARY: Array<[string, string]> = [
  ["ATS score", "How well screening software can read your resume and match it to a job, out of 100. Many companies use this software before a person reads anything."],
  ["Job post (JD)", "The job description: what the company wrote about the role. Orbit uses it to tailor answers and your resume."],
  ["Fit check", "Jobs AI reads a job post next to your resume and says how well you fit, the gaps, and honest tweaks. Free, a few a day."],
  ["Tailor", "Make a copy of your resume aimed at one job. You see every change before you keep it."],
  ["STAR", "A way to tell a work story: the Situation, your Task, the Action you took and the Result. The Story bank helps you write them."],
  ["Credits and minutes", "AI credits pay for AI actions in Resume AI (import, rewrite, tailor, cover letter). Interview minutes pay for mock interviews and live sessions. Neither expires."],
  ["UTR", "The 12-digit number your UPI app gives each payment. Orbit asks for it so your payment can be matched to you."],
];

function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl ring-1 ring-zinc-200 open:bg-zinc-500/[0.04] dark:ring-white/10">
      <summary
        className={cx(
          "flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <span className="flex-1">{q}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-2 px-4 pb-4 text-sm text-zinc-600 dark:text-zinc-300">{children}</div>
    </details>
  );
}

export default function HelpDialog({ open, onClose, onSearch }: { open: boolean; onClose: () => void; onSearch?: () => void }) {
  const welcome = useWelcomeGrant();
  const whatsapp = whatsappLink("Hi Orbit, I need help with: ");
  const mail = mailLink("Help with Orbit");
  const mod = isMacPlatform() ? "⌘" : "Ctrl";
  const contactButton = cx(
    "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium",
    focusRing,
  );
  return (
    <Sheet open={open} onClose={onClose} title="Questions" titleId="help-title">
      <div className="space-y-7 px-5 py-5">
        <section aria-labelledby="help-contact">
          <h3 id="help-contact" className="font-display text-base font-semibold">
            Talk to a person
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Stuck, or a payment hasn't shown up? Tell us what you were doing and we'll reply by email.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Link to={CONTACT_PAGE} onClick={onClose} className={buttonClass("primary", "md", "min-h-12 flex-1")}>
              <Send className="h-4 w-4" aria-hidden /> Send us a message
            </Link>
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noreferrer" className={cx(contactButton, "bg-emerald-600 text-white hover:bg-emerald-700")}>
                <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp us
              </a>
            )}
            {mail && (
              <a href={mail} className={buttonClass("secondary", "md", "min-h-12 flex-1")}>
                <Mail className="h-4 w-4" aria-hidden /> Email {SUPPORT_EMAIL}
              </a>
            )}
          </div>
        </section>

        <section aria-labelledby="help-questions">
          <h3 id="help-questions" className="font-display text-base font-semibold">
            Common questions
          </h3>
          <div className="mt-3 space-y-2">
            <Question q="What's free?">
              {welcome && (
                <p>
                  A new account starts with{" "}
                  {[
                    welcome.interview_minutes ? `${welcome.interview_minutes} interview minutes` : "",
                    welcome.resume_credits ? `${welcome.resume_credits} AI credit${welcome.resume_credits === 1 ? "" : "s"}` : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")}{" "}
                  (one welcome gift per network).
                </p>
              )}
              <p>
                Always free: typing and editing your resume, its ATS score, Word and PDF downloads, job matches, the
                tracker, and a few AI fit checks a day.
              </p>
            </Question>
            <Question q="I paid by UPI. When do my credits arrive?">
              <p>
                Each payment is checked by hand against its UTR, then the credits are added. You can see where it is on{" "}
                <Link to="/billing" onClick={onClose} className="font-medium text-indigo-700 underline dark:text-indigo-300">
                  Plan &amp; credits
                </Link>
                . If it's been more than a day,{" "}
                <Link to={CONTACT_PAGE} onClick={onClose} className="font-medium text-indigo-700 underline dark:text-indigo-300">
                  send us a message
                </Link>{" "}
                with the UTR.
              </p>
            </Question>
            <Question q="Where do I find the UTR?">
              <p>Open the payment in your UPI app. It's the 12-digit number labelled:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Google Pay: "UPI transaction ID"</li>
                <li>PhonePe: "UTR"</li>
                <li>Paytm: "UPI Ref No."</li>
                <li>Your bank's app: "UTR", "RRN" or "Reference number"</li>
              </ul>
            </Question>
            <Question q="Can I use Orbit in a real interview?">
              <p>{USE_WHERE_ALLOWED}</p>
              <p>
                Some employers, colleges and exams don't allow notes or AI help, and breaking their rules can cost you the
                job. Practice is always fine.
              </p>
            </Question>
            <Question q="Orbit can't hear the interviewer">
              <p>{displayAudioHelp()}</p>
            </Question>
            <Question q="Do credits expire? Is there a subscription?">
              <p>No and no. You buy a pack when you need one, it never renews by itself, and what's in it never expires.</p>
            </Question>
          </div>
        </section>

        <section aria-labelledby="help-words">
          <h3 id="help-words" className="font-display text-base font-semibold">
            Words you'll see
          </h3>
          <dl className="mt-3 space-y-3 text-sm">
            {GLOSSARY.map(([term, meaning]) => (
              <div key={term}>
                <dt className="font-medium">{term}</dt>
                <dd className="text-zinc-600 dark:text-zinc-300">{meaning}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="help-keys" className="hidden sm:block">
          <h3 id="help-keys" className="flex items-center gap-2 font-display text-base font-semibold">
            <Keyboard className="h-4 w-4 text-zinc-500" aria-hidden /> Shortcuts
          </h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            <kbd className="rounded-md border border-zinc-300 px-1.5 py-0.5 font-mono text-xs dark:border-white/15">{mod} K</kbd> or{" "}
            <kbd className="rounded-md border border-zinc-300 px-1.5 py-0.5 font-mono text-xs dark:border-white/15">/</kbd> opens search,
            from any page.{" "}
            {onSearch && (
              <button type="button" onClick={onSearch} className={cx("font-medium text-indigo-700 underline dark:text-indigo-300", focusRing)}>
                Open search
              </button>
            )}
          </p>
        </section>

        <nav aria-label="Policies" className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-200/70 pt-4 text-sm dark:border-white/5">
          <Link to={CONTACT_PAGE} onClick={onClose} className={cx("inline-flex min-h-8 items-center rounded text-zinc-600 hover:underline dark:text-zinc-400", focusRing)}>
            Contact
          </Link>
          {POLICY_LINKS.map(({ href, label }) => (
            <a key={href} href={href} className={cx("inline-flex min-h-8 items-center rounded text-zinc-600 hover:underline dark:text-zinc-400", focusRing)}>
              {label}
            </a>
          ))}
        </nav>
      </div>
    </Sheet>
  );
}
