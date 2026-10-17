import { use, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { companies as companyCards, roles as roleCards } from "virtual:question-bank/cards";
import {
  ArrowRight,
  Building2,
  ExternalLink,
  GraduationCap,
  Info,
  Lightbulb,
  ListChecks,
  OrbitWordmark,
  Search,
  Sparkles,
  Target,
  buttonClass,
  cx,
  focusRing,
} from "@orbit/ui";
import { Footer } from "../../components/Footer";
import { SiteMenu } from "../../components/SiteMenu";
import { useAuth } from "../../lib/auth";
import { NotFoundPage } from "../NotFound";
import {
  COMPANIES_PATH,
  COMPANY_GROUPS,
  ROLES_PATH,
  ROLE_GROUPS,
  companyMockLink,
  entryPath,
  firstSentence,
  inGroup,
  questionSections,
  related,
  reviewedOn,
  roleMockLink,
  searchCards,
  warmupLink,
  type BankKind,
} from "./content";
import { loadCompany, loadRole } from "./docs";
import type { BankCard, BankCompany, BankQuestion, BankRole } from "./types";

/**
 * The question bank's public pages: /companies and /roles (every guide, searchable) and one page per company or role
 * (the rounds, what interviewers listen for, practice questions with what a good answer covers, tips), with a mock
 * interview or the free warm-up one click away. The same components are rendered to HTML at build time
 * (src/prerender), so search engines and assistants that don't run JavaScript read the whole guide; the app takes
 * over when it loads. Signed in or out they're the same; only the header's next step differs.
 */

const COMPANY_TOTAL = companyCards.length;
const ROLE_TOTAL = roleCards.length;
/** "1,389": the same grouping in the built page and in the app, wherever it runs. */
const sum = (cards: readonly BankCard[]) => cards.reduce((n, c) => n + c.questions, 0).toLocaleString("en-US");

const navLink = (active: boolean) =>
  cx(
    "inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-medium",
    active ? "text-zinc-900 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
    focusRing,
  );

/** The front door's header and footer around a guide page. */
function BankShell({ kind, children }: { kind: BankKind; children: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="min-h-full overflow-x-clip">
      <header className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className={cx("rounded-lg", focusRing)} aria-label="Orbit home">
          <OrbitWordmark size={26} />
        </Link>
        <span className="hidden h-5 w-px bg-zinc-300 sm:block dark:bg-white/15" aria-hidden="true" />
        <nav aria-label="Interview guides" className="hidden items-center gap-1 sm:flex">
          <Link to={COMPANIES_PATH} className={navLink(kind === "company")} aria-current={kind === "company" ? "page" : undefined}>
            Companies
          </Link>
          <Link to={ROLES_PATH} className={navLink(kind === "role")} aria-current={kind === "role" ? "page" : undefined}>
            Roles
          </Link>
          <Link to="/warmup" className={navLink(false)}>
            Free warm-up
          </Link>
        </nav>
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          <SiteMenu />
          {user ? (
            <Link to="/mock" className={buttonClass("secondary", "md", "min-h-11")}>
              Back to Practice
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonClass("secondary", "md", "hidden min-h-11 sm:inline-flex")}>
                Sign in
              </Link>
              <Link to="/register" className={buttonClass("primary", "md", "min-h-11")}>
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {children}
      </main>
      <Footer />
    </div>
  );
}

function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="pt-2 text-sm text-zinc-600 dark:text-zinc-400">
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

// ─── The lists ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function CompaniesPage() {
  return <BankIndexView kind="company" />;
}

export function RolesPage() {
  return <BankIndexView kind="role" />;
}

/** Every company or role guide: grouped, or the ones matching what's typed. */
export function BankIndexView({ kind }: { kind: BankKind }) {
  const [query, setQuery] = useState("");
  const company = kind === "company";
  const cards = company ? companyCards : roleCards;
  const groups = company ? COMPANY_GROUPS : ROLE_GROUPS;
  const found = searchCards(cards, query);
  const typed = query.trim();
  const noun = company ? "companies" : "roles";

  return (
    <BankShell kind={kind}>
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: company ? "Companies" : "Roles" }]} />
      <section aria-labelledby="bank-title" className="pb-8 pt-6 sm:pt-10">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Free · no sign-up to read
        </p>
        <h1 id="bank-title" className="mt-4 text-balance font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {company ? "Company interview guides" : "Interview guides by role"}
        </h1>
        <p className="mt-3 max-w-2xl text-base text-zinc-600 dark:text-zinc-300">
          {company
            ? `How ${cards.length} companies interview, as candidates commonly report it: the rounds, what interviewers listen for, and ${sum(cards)} practice questions written by Orbit, each with what a good answer covers.`
            : `What interviews for ${cards.length} jobs usually test, from campus placements to nursing: the usual stages, the skills checked, and ${sum(cards)} practice questions written by Orbit, each with what a good answer covers.`}{" "}
          Practise any of them out loud in a mock interview, or free in the warm-up.
        </p>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {company ? (
            <>
              Preparing for a kind of job rather than a company?{" "}
              <Link to={ROLES_PATH} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                Browse {ROLE_TOTAL} role guides
              </Link>
              .
            </>
          ) : (
            <>
              Preparing for one company?{" "}
              <Link to={COMPANIES_PATH} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                Browse {COMPANY_TOTAL} company guides
              </Link>
              .
            </>
          )}
        </p>
        <div className="mt-6 max-w-md">
          <label htmlFor="bank-search" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Search {noun}
          </label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
            <input
              id="bank-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={company ? "e.g. TCS, Amazon, Deloitte" : "e.g. data analyst, nurse, sales"}
              autoComplete="off"
              maxLength={80}
              className={cx(
                "block min-h-11 w-full rounded-xl border border-zinc-300 bg-white pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-500 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100",
                focusRing,
              )}
            />
          </div>
        </div>
      </section>

      {typed ? (
        <section aria-labelledby="results-title" className="pb-4">
          <h2 id="results-title" className="font-display text-lg font-semibold" aria-live="polite">
            {found.length === 0 ? `No guide for “${typed}” yet` : `${found.length} ${found.length === 1 ? "guide matches" : "guides match"} “${typed}”`}
          </h2>
          {found.length === 0 ? (
            <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              You can still practise for it: a mock interview asks the usual questions for{" "}
              {company ? "any company" : "any role"}, from your resume and the job post.{" "}
              <Link
                to={company ? companyMockLink({ name: typed }) : `/mock?${new URLSearchParams({ role: typed })}`}
                className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}
              >
                Practise for {typed}
              </Link>
            </p>
          ) : (
            <CardGrid kind={kind} cards={found} />
          )}
        </section>
      ) : (
        groups.map(([group, label]) => {
          const inThis = inGroup(cards, group);
          if (!inThis.length) return null;
          return (
            <section key={group} aria-labelledby={`group-${group}`} className="border-t border-zinc-200/70 py-8 dark:border-white/5">
              <h2 id={`group-${group}`} className="font-display text-xl font-semibold tracking-tight">
                {label}
              </h2>
              <CardGrid kind={kind} cards={inThis} />
            </section>
          );
        })
      )}
      <AboutTheGuides />
    </BankShell>
  );
}

function CardGrid({ kind, cards }: { kind: BankKind; cards: readonly BankCard[] }) {
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <li key={c.slug}>
          <Link
            to={entryPath(kind, c.slug)}
            className={cx("glass-panel lift flex h-full flex-col rounded-2xl p-4 hover:border-indigo-400/40 dark:hover:border-indigo-400/30", focusRing)}
          >
            <span className="font-display text-base font-semibold">{c.name}</span>
            <span className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{firstSentence(c.summary)}</span>
            <span className="mt-auto pt-3 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              {c.questions} practice questions <ArrowRight className="inline h-3 w-3" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AboutTheGuides() {
  return (
    <section aria-labelledby="about-guides" className="mt-8 rounded-2xl border border-zinc-200 bg-white/70 p-5 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
      <h2 id="about-guides" className="flex items-center gap-2 font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
        <Info className="h-4 w-4" aria-hidden /> About these guides
      </h2>
      <p className="mt-2 max-w-3xl">
        Written by Orbit from companies' own public pages (their published values, principles and hiring pages) and
        what candidates commonly report. Interview processes change by team, level and year, so treat each guide as a
        starting point and check the job post and what your recruiter tells you. The questions are Orbit's own practice
        questions in the style these interviews are known for, not questions taken from any company's interviews.
        Orbit isn't affiliated with the companies named.
      </p>
    </section>
  );
}

// ─── One guide ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function CompanyPage() {
  const { slug = "" } = useParams();
  const company = use(loadCompany(slug));
  return company ? <GuideView kind="company" entry={company} /> : <NotFoundPage />;
}

export function RolePage() {
  const { slug = "" } = useParams();
  const role = use(loadRole(slug));
  return role ? <GuideView kind="role" entry={role} /> : <NotFoundPage />;
}

const sectionTitle = "font-display text-xl font-semibold tracking-tight sm:text-2xl";

/** A company's or a role's guide. */
export function GuideView({ kind, entry }: { kind: BankKind; entry: BankCompany | BankRole }) {
  const { user } = useAuth();
  const company = kind === "company";
  const name = entry.name;
  const mock = company ? companyMockLink(entry) : roleMockLink(entry as BankRole);
  const abroad = company ? (entry as BankCompany).abroad : undefined;
  const others = related(company ? companyCards : roleCards, entry.slug);
  const groupLabel = (company ? COMPANY_GROUPS : ROLE_GROUPS).find(([g]) => g === entry.group)?.[1] ?? "";
  const title = company ? `${name} interview process and practice questions` : `${name} interview questions and what to expect`;

  const actions = (dark: boolean) => (
    <div className="flex flex-wrap gap-3">
      <Link
        to={user ? mock : "/register"}
        state={user ? undefined : { from: mock }}
        className={dark ? cx("inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-100", focusRing) : buttonClass("primary", "lg", "min-h-11")}
      >
        <Target className="h-4 w-4" aria-hidden />
        {company ? `Practise a mock interview in ${name}'s style` : `Practise a ${name.toLowerCase()} mock interview`}
      </Link>
      <Link
        to={warmupLink(kind, entry.slug)}
        className={dark ? cx("inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/30 px-4 text-sm font-semibold text-white hover:bg-white/10", focusRing) : buttonClass("secondary", "lg", "min-h-11")}
      >
        Warm up free on these questions
      </Link>
    </div>
  );

  return (
    <BankShell kind={kind}>
      <Breadcrumbs
        items={[
          { label: "Home", to: "/" },
          { label: company ? "Companies" : "Roles", to: company ? COMPANIES_PATH : ROLES_PATH },
          { label: name },
        ]}
      />
      <article aria-labelledby="guide-title">
        <header className="pb-8 pt-6 sm:pt-10">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
            {company ? <Building2 className="h-3.5 w-3.5" aria-hidden /> : <GraduationCap className="h-3.5 w-3.5" aria-hidden />}
            {company ? "Company interview guide" : "Role interview guide"}
          </p>
          <h1 id="guide-title" className="mt-4 text-balance font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-base text-zinc-700 dark:text-zinc-300">{entry.summary}</p>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {company ? "As candidates commonly report it; it varies by team, level and year." : "What candidates commonly report; it varies by employer, level and country."}{" "}
            Last reviewed {reviewedOn(entry.reviewed)}.
          </p>
          <div className="mt-6">{actions(false)}</div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby="rounds-title" className="glass-panel rounded-2xl p-5">
            <h2 id="rounds-title" className={sectionTitle}>
              {company ? "The interview process" : "The usual stages"}
            </h2>
            <ol className="mt-4 space-y-2.5 text-sm text-zinc-700 dark:text-zinc-300">
              {entry.rounds.map((r, i) => (
                <li key={r} className="flex gap-2.5">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-zinc-500/10 text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{r}</span>
                </li>
              ))}
            </ol>
            {abroad && (
              <div className="mt-5 border-t border-zinc-200/70 pt-4 dark:border-white/10">
                <h3 className="font-display text-sm font-semibold">Outside India</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Candidates elsewhere more often report:</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700 marker:text-zinc-500 dark:text-zinc-300">
                  {abroad.rounds.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              </div>
            )}
          </section>
          <section aria-labelledby="looks-title" className="glass-panel rounded-2xl p-5">
            <h2 id="looks-title" className={sectionTitle}>
              {company ? "What interviewers listen for" : "What interviewers check"}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {entry.looks_for.map((v) => (
                <li key={v} className="rounded-full bg-indigo-500/10 px-3 py-1.5 text-sm font-medium text-indigo-800 ring-1 ring-indigo-500/20 dark:text-indigo-200">
                  {v}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {questionSections(kind, name).map(([type, heading]) => (
          <QuestionSection key={type} id={`q-${type}`} heading={heading} questions={entry.questions.filter((q) => q.type === type)} />
        ))}

        <section aria-labelledby="tips-title" className="pt-10">
          <h2 id="tips-title" className={cx(sectionTitle, "flex items-center gap-2")}>
            <Lightbulb className="h-5 w-5 text-indigo-600 dark:text-indigo-300" aria-hidden /> Tips
          </h2>
          <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-5 text-base text-zinc-700 marker:text-zinc-500 dark:text-zinc-300">
            {entry.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="practise-title" className="mt-10 rounded-3xl bg-zinc-900 p-6 text-white ring-1 ring-inset ring-white/10 sm:p-8">
          <h2 id="practise-title" className="font-display text-2xl font-semibold tracking-tight">
            Practise it out loud
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-white/85">
            {company
              ? `A mock interview asks the way ${name}'s interviewers are known to, follows up on your answers and gives you a report. The warm-up is free, needs no account and checks five of these questions as you answer.`
              : `A mock interview asks what ${name.toLowerCase()} interviews usually test, follows up on your answers and gives you a report. The warm-up is free, needs no account and checks five of these questions as you answer.`}
          </p>
          <div className="mt-5">{actions(true)}</div>
        </section>

        <section aria-labelledby="about-title" className="mt-10 text-sm text-zinc-600 dark:text-zinc-400">
          <h2 id="about-title" className="flex items-center gap-2 font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <Info className="h-4 w-4" aria-hidden /> About this guide
          </h2>
          <p className="mt-2 max-w-3xl">
            {company
              ? `Written by Orbit from ${name}'s own public pages and what candidates commonly report. Orbit isn't affiliated with ${name}. The questions are practice questions in the style of its interviews, not questions taken from them.`
              : "Written by Orbit from what candidates and interviewers commonly describe for this kind of job. The questions are Orbit's own practice questions, not questions taken from any employer's interviews."}{" "}
            Processes change, so check the job post and what your recruiter tells you.
          </p>
          {entry.sources && entry.sources.length > 0 && (
            <>
              <h3 className="mt-4 font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sources</h3>
              <ul className="mt-1.5 space-y-1">
                {entry.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} rel="noopener noreferrer" className={cx("inline-flex items-center gap-1 rounded text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                      {s.title} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </article>

      {others.length > 0 && (
        <nav aria-labelledby="more-title" className="mt-12 border-t border-zinc-200/70 pt-8 dark:border-white/5">
          <h2 id="more-title" className="font-display text-xl font-semibold tracking-tight">
            More guides: {groupLabel.toLowerCase()}
          </h2>
          <CardGrid kind={kind} cards={others} />
          <p className="mt-6 text-sm">
            <Link to={company ? COMPANIES_PATH : ROLES_PATH} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
              All {company ? `${COMPANY_TOTAL} company` : `${ROLE_TOTAL} role`} guides
            </Link>
            <span className="text-zinc-500" aria-hidden="true">
              {" · "}
            </span>
            <Link to={company ? ROLES_PATH : COMPANIES_PATH} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
              {company ? "Guides by role" : "Guides by company"}
            </Link>
          </p>
        </nav>
      )}
    </BankShell>
  );
}

function QuestionSection({ id, heading, questions }: { id: string; heading: string; questions: BankQuestion[] }) {
  if (!questions.length) return null;
  return (
    <section aria-labelledby={id} className="pt-10">
      <h2 id={id} className={cx(sectionTitle, "flex items-center gap-2")}>
        <ListChecks className="h-5 w-5 text-indigo-600 dark:text-indigo-300" aria-hidden /> {heading}
      </h2>
      <ol className="mt-4 grid gap-3">
        {questions.map((q) => (
          <li key={q.text} className="glass-panel rounded-2xl p-4 sm:p-5">
            <h3 className="font-display text-base font-semibold leading-snug">{q.text}</h3>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-600 dark:text-zinc-400">A good answer covers</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-zinc-700 marker:text-zinc-500 dark:text-zinc-300">
              {q.covers.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
