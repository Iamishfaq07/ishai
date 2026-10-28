import { Link } from "react-router-dom";
import { ArrowRight, buttonClass, cx, focusRing } from "@orbit/ui";
import { useAuth } from "../../lib/auth";
import { useWelcomeGrant } from "../../lib/welcome";
import { COPILOT_PAGE, LINKEDIN_PAGE, PRODUCT_TILE, siteProducts, type SiteProduct } from "../../marketing/catalog";
import { IconTile } from "../../marketing/primitives";
import { JOBS_AI_HOME } from "../jobs/paths";
import { RESUME_AI_HOME } from "../resume/paths";
import { companyMockLink, roleMockLink, warmupLink, type BankKind } from "./content";
import type { BankCard, BankRole, CompanyGroup, RoleGroup } from "./types";

/** Guides whose interviews commonly include a coding round: their kit adds coding practice. */
const CODING_COMPANIES: readonly CompanyGroup[] = ["it-services", "india-product", "global-tech"];
const CODING_ROLES: readonly RoleGroup[] = ["engineering", "data"];

interface KitTool {
  product: SiteProduct["id"];
  title: string;
  text: string;
  to: string;
  state?: unknown;
  /** What it costs, only where the pricing table says so (PricingSection): never a guess. */
  cost?: string;
}

interface Stage {
  label: string;
  tools: KitTool[];
}

/** The guide (or the Atlas's best match) the kit is about; none on the Atlas before a search. */
export interface KitSubject {
  kind: BankKind;
  card: Pick<BankCard, "slug" | "name" | "group"> & { mock?: BankRole["mock"] };
}

function stages(subject: KitSubject | null, minutes: number, signedIn: boolean): Stage[] {
  const name = subject?.card.name;
  const company = subject?.kind === "company";
  const forName = name ? (company ? `${name}'s` : `a ${name.toLowerCase()}`) : "your";
  const mock = !subject ? "/mock" : company ? companyMockLink(subject.card) : subject.card.mock ? roleMockLink(subject.card as Pick<BankRole, "name" | "mock">) : "/mock";
  const coding = subject
    ? company ? CODING_COMPANIES.includes(subject.card.group as CompanyGroup) : CODING_ROLES.includes(subject.card.group as RoleGroup)
    : true;
  return [
    {
      label: "Before you apply",
      tools: [
        {
          product: "resume",
          title: name && company ? `Fit your resume to a ${name} job` : "Fit your resume to the job",
          text: "Paste the job post: see your resume's ATS score against it and what's missing, then tailor it with AI, keeping your own numbers.",
          to: RESUME_AI_HOME,
          cost: "Score free · AI uses credits",
        },
        {
          product: "jobs",
          title: name && company ? `${name} jobs that fit you` : "Jobs that fit you",
          text: "New jobs from companies' own careers pages, matched to your resume, with a tracker for every application.",
          to: JOBS_AI_HOME,
          cost: "Free",
        },
        {
          product: "linkedin",
          title: "A LinkedIn recruiters stop at",
          text: "A score out of 100 and what to fix first, so a recruiter's search finds you for the role.",
          to: LINKEDIN_PAGE,
          cost: "Score free",
        },
      ],
    },
    {
      label: "Before the interview",
      tools: [
        {
          product: "practice",
          title: subject ? `Warm up on ${forName} questions` : "Warm up on any guide's questions",
          text: "Answer out loud or by typing and see straight away what to tighten: length, structure, filler words.",
          to: subject ? warmupLink(subject.kind, subject.card.slug) : "/warmup",
          cost: "Free, no account",
        },
        {
          product: "practice",
          title: name ? (company ? `A mock interview in ${name}'s style` : `A ${name.toLowerCase()} mock interview`) : "A full mock interview",
          text: "Saba, Orbit's AI interviewer, asks out loud, follows up on what you actually said and scores every answer with a stronger way to say it.",
          to: signedIn ? mock : "/register",
          state: signedIn ? undefined : { from: mock },
          cost: minutes ? `${minutes} free minutes for a new account` : "Uses interview minutes",
        },
        ...(coding
          ? [{
              product: "code" as const,
              title: "Coding rounds by pattern",
              text: "Solve the problem, run the tests, then get a review of your approach, as a coding round would.",
              to: "/#code-ai",
            }]
          : []),
      ],
    },
    {
      label: "On the day",
      tools: [
        {
          product: "copilot",
          title: "Live answers from your resume",
          text: "In calls where AI help is allowed, Orbit hears the question and suggests an answer from your resume and the job post. Check the rules first: many interviews don't allow it.",
          to: COPILOT_PAGE,
          cost: "Uses interview minutes",
        },
      ],
    },
    {
      label: "After the offer",
      tools: [
        {
          product: "offer",
          title: "Know what the offer is worth",
          text: "What it's really worth, line by line, and a plan to ask for more.",
          to: "/#offer-ai",
        },
      ],
    },
  ];
}

/**
 * The rest of Orbit for this interview, from the application to the offer: shown on every company and role guide and
 * on the Atlas, so a visitor reading the questions finds the tools that prepare them. Each tool says what it costs,
 * in the pricing table's words.
 */
export function PrepKit({ subject, id = "prep-kit" }: { subject: KitSubject | null; id?: string }) {
  const { user } = useAuth();
  const welcome = useWelcomeGrant();
  const minutes = welcome?.interview_minutes ?? 0;
  const products = new Map(siteProducts(true).map((p) => [p.id, p]));
  const name = subject?.card.name;
  const all = stages(subject, minutes, Boolean(user));

  return (
    <section aria-labelledby={id} className="mt-14 border-t mk-line pt-10">
      <h2 id={id} className="mk-h3 text-zinc-950 dark:text-white">
        {name ? `Everything for your ${name} interview, in one place` : "Everything for your interview, in one place"}
      </h2>
      <p className="mt-2 max-w-3xl text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
        The questions are a start. Orbit takes you from the application to the offer: your resume, the jobs, practice out
        loud and the offer itself. Start free; you pay only for AI work and interview minutes.
      </p>
      <ol className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {all.map((stage, i) => (
          <li key={stage.label} className="flex min-w-0 flex-col">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-500/10 text-[0.6875rem] tabular-nums text-zinc-700 dark:text-zinc-200">{i + 1}</span>
              {stage.label}
            </p>
            <ul className="mt-3 grid gap-3">
              {stage.tools.map((t) => {
                const product = products.get(t.product)!;
                return (
                  <li key={t.title}>
                    <Link
                      to={t.to}
                      state={t.state}
                      className={cx("group flex h-full flex-col rounded-2xl border mk-line mk-surface p-4 hover:border-[rgb(var(--site-line-strong))]", focusRing)}
                    >
                      <span className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        <IconTile icon={product.icon} tone={PRODUCT_TILE[product.id]} size="sm" />
                        {product.name}
                      </span>
                      <span className="mt-3 font-semibold leading-snug text-zinc-950 dark:text-white">{t.title}</span>
                      <span className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.text}</span>
                      <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                        {t.cost ? (
                          <span className={cx("font-medium", /free/i.test(t.cost) ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-600 dark:text-zinc-400")}>
                            {t.cost}
                          </span>
                        ) : <span />}
                        <ArrowRight className="h-4 w-4 text-zinc-500 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      {!user && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link to="/register" className={buttonClass("primary", "lg", "min-h-12")}>
            Start free <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link to="/pricing" className={cx("rounded px-2 py-2 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
            What's free and what's paid
          </Link>
        </div>
      )}
    </section>
  );
}
