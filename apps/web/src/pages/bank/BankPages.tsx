import { use, useRef, useState, type ReactNode } from "react";
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
  Search,
  Target,
  buttonClass,
  cx,
  focusRing,
} from "@orbit/ui";
import { KashSecContext } from "../../components/KashSec";
import { Input } from "../../components/ui";
import { isSecurityRole } from "../../lib/security";
import { inkButton } from "../../marketing/ProductPage";
import { PublicLayout } from "../../marketing/PublicLayout";
import { Container, Eyebrow, IconTile } from "../../marketing/primitives";
import { StickyCta } from "../../marketing/StickyCta";
import { useAuth } from "../../lib/auth";
import { NotFoundPage } from "../NotFound";
import {
  ATLAS_PATH,
  COMPANIES_PATH,
  COMPANY_GROUPS,
  ROLES_PATH,
  ROLE_GROUPS,
  companyMockLink,
  crossLinks,
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
import { CompanyJobs } from "./CompanyJobs";
import { PrepKit } from "./PrepKit";
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

/** The guides' own tabs (Companies, Roles, the free warm-up), under the site's header. */
function GuideTabs({ kind }: { kind: BankKind | "atlas" }) {
  const tab = (active: boolean) =>
    cx(
      "inline-flex min-h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-1 text-sm font-medium transition-colors duration-quick",
      active
        ? "border-zinc-900 text-zinc-950 dark:border-white dark:text-white"
        : "border-transparent text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white",
      focusRing,
    );
  return (
    <nav aria-label="Interview guides" className="flex gap-6 overflow-x-auto border-b mk-line">
      <Link to={ATLAS_PATH} className={tab(kind === "atlas")} aria-current={kind === "atlas" ? "page" : undefined}>
        Search all
      </Link>
      <Link to={COMPANIES_PATH} className={tab(kind === "company")} aria-current={kind === "company" ? "page" : undefined}>
        Companies
      </Link>
      <Link to={ROLES_PATH} className={tab(kind === "role")} aria-current={kind === "role" ? "page" : undefined}>
        Roles
      </Link>
      <Link to="/warmup" className={tab(false)}>
        Free warm-up
      </Link>
    </nav>
  );
}

/** A guide page in the public site's layout (marketing/PublicLayout): its header and footer, the guides' tabs, the
 *  grid. Signed in, the header's next step is Practice. */
export function BankShell({ kind, children }: { kind: BankKind | "atlas"; children: ReactNode }) {
  const { user } = useAuth();
  return (
    <PublicLayout
      context="Interview guides"
      authState={{ from: "/mock" }}
      actions={
        user ? (
          <Link to="/mock" className={buttonClass("secondary", "md", "min-h-10")}>
            Back to Practice
          </Link>
        ) : undefined
      }
    >
      <Container className="pb-20 pt-6 sm:pt-8">
        <GuideTabs kind={kind} />
        {children}
      </Container>
    </PublicLayout>
  );
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="pt-6 text-sm text-zinc-600 dark:text-zinc-400">
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
      <section aria-labelledby="bank-title" className="pb-10 pt-8 sm:pt-12">
        <Eyebrow>Free, no sign-up to read</Eyebrow>
        <h1 id="bank-title" className="mk-display mt-4 text-zinc-950 dark:text-white">
          {company ? "Company interview guides" : "Interview guides by role"}
        </h1>
        <p className="mk-lead mt-5 max-w-3xl text-zinc-600 dark:text-zinc-300">
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
        <div className="mt-8 max-w-md">
          <label htmlFor="bank-search" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Search {noun}
          </label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
            <Input
              id="bank-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={company ? "e.g. TCS, Amazon, Deloitte" : "e.g. data analyst, nurse, sales"}
              autoComplete="off"
              maxLength={80}
              className="min-h-11 pl-9"
            />
          </div>
        </div>
      </section>

      {typed ? (
        <section aria-labelledby="results-title" className="pb-4">
          <h2 id="results-title" className="mk-h3 text-zinc-950 dark:text-white" aria-live="polite">
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
            <section key={group} aria-labelledby={`group-${group}`} className="border-t mk-line py-10">
              <h2 id={`group-${group}`} className="mk-h3 text-zinc-950 dark:text-white">
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

export function CardGrid({ kind, cards }: { kind: BankKind; cards: readonly BankCard[] }) {
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <li key={c.slug}>
          <Link
            to={entryPath(kind, c.slug)}
            className={cx("flex h-full flex-col rounded-2xl border mk-line mk-surface p-5 transition-colors duration-quick hover:border-[rgb(var(--site-line-strong))]", focusRing)}
          >
            <span className="text-base font-semibold text-zinc-950 dark:text-white">{c.name}</span>
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
    <section aria-labelledby="about-guides" className="mt-10 rounded-2xl border mk-line mk-band p-6 text-sm text-zinc-600 dark:text-zinc-300">
      <h2 id="about-guides" className="flex items-center gap-2 text-base font-semibold text-zinc-950 dark:text-white">
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

const sectionTitle = "mk-h3 text-zinc-950 dark:text-white";

/** A company's or a role's guide. */
export function GuideView({ kind, entry }: { kind: BankKind; entry: BankCompany | BankRole }) {
  const { user } = useAuth();
  const company = kind === "company";
  const name = entry.name;
  const mock = company ? companyMockLink(entry) : roleMockLink(entry as BankRole);
  const abroad = company ? (entry as BankCompany).abroad : undefined;
  const others = related(company ? companyCards : roleCards, entry.slug);
  const across = crossLinks(kind, entry, { companies: companyCards, roles: roleCards });
  const groupLabel = (company ? COMPANY_GROUPS : ROLE_GROUPS).find(([g]) => g === entry.group)?.[1] ?? "";
  const year = entry.reviewed.slice(0, 4);
  const title = company ? `${name} interview process and questions (${year})` : `${name} interview questions and what to expect (${year})`;
  const note = company ? (entry as BankCompany).note : undefined;
  const heroCtas = useRef<HTMLDivElement>(null);
  const practise = useRef<HTMLElement>(null);

  const actions = (dark: boolean) => (
    <div className="flex flex-wrap gap-3">
      <Link
        to={user ? mock : "/register"}
        state={user ? undefined : { from: mock }}
        className={dark ? inkButton.primary : buttonClass("primary", "lg", "min-h-12")}
      >
        <Target className="h-4 w-4" aria-hidden />
        {company ? `Practise a mock interview in ${name}'s style` : `Practise a ${name.toLowerCase()} mock interview`}
      </Link>
      <Link
        to={warmupLink(kind, entry.slug)}
        className={dark ? inkButton.secondary : buttonClass("secondary", "lg", "min-h-12")}
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
        <header className="pb-10 pt-8 sm:pt-12">
          <Eyebrow plain>
            <IconTile icon={company ? Building2 : GraduationCap} size="sm" />
            {company ? "Company interview guide" : "Role interview guide"}
          </Eyebrow>
          <h1 id="guide-title" className="mk-h2 mt-5 max-w-4xl text-zinc-950 dark:text-white">
            {title}
          </h1>
          {note && (
            <p className="mt-5 flex max-w-3xl gap-2 rounded-xl border mk-line mk-band px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{note}</span>
            </p>
          )}
          <p className="mk-lead mt-5 max-w-3xl text-zinc-600 dark:text-zinc-300">{entry.summary}</p>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {company ? "As candidates commonly report it; it varies by team, level and year." : "What candidates commonly report; it varies by employer, level and country."}{" "}
            Last reviewed {reviewedOn(entry.reviewed)}.
          </p>
          <div ref={heroCtas} className="mt-8">{actions(false)}</div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby="rounds-title" className="rounded-2xl border mk-line mk-surface p-6">
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
              <div className="mt-5 border-t mk-line pt-4">
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">Outside India</h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Candidates elsewhere more often report:</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-700 marker:text-zinc-500 dark:text-zinc-300">
                  {abroad.rounds.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              </div>
            )}
          </section>
          <section aria-labelledby="looks-title" className="rounded-2xl border mk-line mk-surface p-6">
            <h2 id="looks-title" className={sectionTitle}>
              {company ? "What interviewers listen for" : "What interviewers check"}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {entry.looks_for.map((v) => (
                <li key={v} className="rounded-full border mk-line px-3 py-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {v}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <QuickAnswers kind={kind} entry={entry} />

        {company && <div className="mt-8"><CompanyJobs slug={entry.slug} name={name} /></div>}

        {questionSections(kind, name).map(([type, heading]) => (
          <QuestionSection key={type} id={`q-${type}`} heading={heading} questions={entry.questions.filter((q) => q.type === type)} practise={warmupLink(kind, entry.slug)} />
        ))}

        <section aria-labelledby="tips-title" className="pt-10">
          <h2 id="tips-title" className={cx(sectionTitle, "flex items-center gap-2")}>
            <IconTile icon={Lightbulb} size="sm" /> Tips
          </h2>
          <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-5 text-base text-zinc-700 marker:text-zinc-500 dark:text-zinc-300">
            {entry.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        {isSecurityRole(name, ...entry.aliases) && <KashSecContext placement="role-guide" className="mt-10 max-w-3xl" />}

        <section ref={practise} aria-labelledby="practise-title" className="mt-14 rounded-3xl bg-zinc-950 p-6 text-white sm:p-10 dark:border dark:border-[rgb(var(--site-line))] dark:bg-[rgb(var(--site-surface))]">
          <h2 id="practise-title" className="mk-h2 text-white">
            Practise it out loud
          </h2>
          <p className="mt-4 max-w-2xl text-[0.9375rem] leading-relaxed text-white/75">
            {company
              ? `A mock interview asks the way ${name}'s interviewers are known to, follows up on your answers and gives you a report. The warm-up is free, needs no account and checks five of these questions as you answer.`
              : `A mock interview asks what ${name.toLowerCase()} interviews usually test, follows up on your answers and gives you a report. The warm-up is free, needs no account and checks five of these questions as you answer.`}
          </p>
          <div className="mt-8">{actions(true)}</div>
        </section>

        <section aria-labelledby="about-title" className="mt-10 text-sm text-zinc-600 dark:text-zinc-400">
          <h2 id="about-title" className="flex items-center gap-2 text-base font-semibold text-zinc-950 dark:text-white">
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
              <h3 className="mt-4 text-sm font-semibold text-zinc-950 dark:text-white">Sources</h3>
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

      <PrepKit subject={{ kind, card: entry }} />

      {across.length > 0 && (
        <nav aria-labelledby="across-title" className="mt-14 border-t mk-line pt-10">
          <h2 id="across-title" className="mk-h3 text-zinc-950 dark:text-white">
            {company ? "Role guides to read with this one" : "Company guides to read with this one"}
          </h2>
          <CardGrid kind={company ? "role" : "company"} cards={across} />
        </nav>
      )}

      {others.length > 0 && (
        <nav aria-labelledby="more-title" className="mt-14 border-t mk-line pt-10">
          <h2 id="more-title" className="mk-h3 text-zinc-950 dark:text-white">
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
      {!user && (
        <StickyCta after={heroCtas} before={practise} to="/register" state={{ from: mock }}
          line={company ? `Mock interview in ${name}'s style.` : `A ${name.toLowerCase()} mock interview.`} />
      )}
    </BankShell>
  );
}

function QuestionSection({ id, heading, questions, practise }: { id: string; heading: string; questions: BankQuestion[]; practise: string }) {
  if (!questions.length) return null;
  return (
    <section aria-labelledby={id} className="pt-10">
      <h2 id={id} className={cx(sectionTitle, "flex items-center gap-2")}>
        <IconTile icon={ListChecks} size="sm" /> {heading}
      </h2>
      <ol className="mt-5 grid gap-4">
        {questions.map((q) => (
          <li key={q.text} className="rounded-2xl border mk-line mk-surface p-5 sm:p-6">
            <h3 className="text-base font-semibold leading-snug text-zinc-950 dark:text-white">{q.text}</h3>
            <p className="mt-3 text-xs font-medium text-zinc-600 dark:text-zinc-400">A good answer covers</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-zinc-700 marker:text-zinc-500 dark:text-zinc-300">
              {q.covers.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm">
        <Link to={practise} className={cx("inline-flex items-center gap-1.5 rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
          <Target className="h-4 w-4" aria-hidden /> Practise these out loud, free, no account <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </p>
    </section>
  );
}

/**
 * The guide in four lines, first thing after the process (search engines and assistants quote a page's direct answers):
 * every line is the guide's own content, restated, never anything it doesn't show.
 */
function QuickAnswers({ kind, entry }: { kind: BankKind; entry: BankCompany | BankRole }) {
  const company = kind === "company";
  const name = entry.name;
  const behavioral = entry.questions.find((q) => q.type === "behavioral");
  const role = entry.questions.find((q) => q.type === "role");
  const rows: Array<[string, string]> = [
    [company ? `How many interview rounds does ${name} have?` : `What are the stages of a ${name.toLowerCase()} interview?`,
      `Candidates commonly report ${entry.rounds.length} stages: ${entry.rounds.join("; ")}. It varies by team, level and year.`],
    [company ? `What does ${name} look for in an interview?` : `What do ${name.toLowerCase()} interviews check?`,
      `${entry.looks_for.slice(0, 5).join("; ")}${entry.looks_for.length > 5 ? "; and more below" : ""}.`],
    [company ? `What questions does ${name} ask?` : `What questions come up in a ${name.toLowerCase()} interview?`,
      [behavioral && `Expect behavioural questions such as “${behavioral.text}”`, role && `questions about the work such as “${role.text}”`].filter(Boolean).join(", and ") +
        `. This guide has ${entry.questions.length} practice questions, each with what a good answer covers.`],
    [company ? `How do I prepare for a ${name} interview?` : `How do I prepare for a ${name.toLowerCase()} interview?`, entry.tips.slice(0, 2).join(" ")],
  ];
  return (
    <section aria-labelledby="quick-title" className="mt-8 rounded-2xl border mk-line mk-surface p-6">
      <h2 id="quick-title" className={sectionTitle}>In short</h2>
      <dl className="mt-4 space-y-4 text-sm">
        {rows.map(([q, a]) => (
          <div key={q}>
            <dt className="font-semibold text-zinc-950 dark:text-white">{q}</dt>
            <dd className="mt-1 text-zinc-700 dark:text-zinc-300">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
