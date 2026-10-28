import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { companies as companyCards, roles as roleCards } from "virtual:question-bank/cards";
import { ArrowRight, Building2, GraduationCap, Search, Target, cx, focusRing } from "@orbit/ui";
import { ATLAS_FAQ } from "../../../worker/faqs/atlas.js";
import { Input } from "../../components/ui";
import { FaqBlock } from "../../marketing/kit/FaqBlock";
import { Eyebrow } from "../../marketing/primitives";
import { BankShell, Breadcrumbs } from "./BankPages";
import { CompanyJobs } from "./CompanyJobs";
import { COMPANIES_PATH, COMPANY_GROUPS, ROLES_PATH, ROLE_GROUPS, companyMockLink, entryPath, firstSentence, inGroup, searchCards, warmupLink, type BankKind } from "./content";
import type { BankCard } from "./types";

/** Words people add to a search that don't name the company or role: "netflix interview questions" is Netflix. */
const FILLER = /\b(interviews?|questions?|q ?& ?a|process(?:es)?|rounds?|experiences?|prep(?:aration)?|preparing|hiring|selection|recruitment|guides?|tips|for|at|in|the|a|an|how|to|crack|jobs?|careers?|company|role|20\d\d)\b/g;

export function atlasQuery(text: string): string {
  return text.toLowerCase().replace(FILLER, " ").replace(/\s+/g, " ").trim();
}

/** Where the Atlas starts: companies people search for most in Orbit's own Search Console report. */
const START = ["netflix", "amazon", "google", "tata-motors", "tech-mahindra", "hdfc-bank", "deloitte", "tcs", "spotify", "stripe", "nvidia", "infosys"];

interface Hit {
  kind: BankKind;
  card: BankCard;
}

const sumQuestions = (cards: readonly BankCard[]) => cards.reduce((n, c) => n + c.questions, 0).toLocaleString("en-US");

/**
 * Interview Atlas (/interview-questions): one search across every company and role guide. Typing "Netflix interview"
 * suggests Netflix's guide (its process, what interviewers listen for, practice questions), its open jobs and a free
 * warm-up; Enter opens the first. The full A to Z of guides is on the page too, so it reads (and is crawled) without
 * JavaScript.
 */
export function AtlasPage() {
  const navigate = useNavigate();
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = atlasQuery(text);

  const hits: Hit[] = useMemo(() => {
    if (!query) return [];
    return [
      ...searchCards(companyCards, query).map((card) => ({ kind: "company" as const, card })),
      ...searchCards(roleCards, query).map((card) => ({ kind: "role" as const, card })),
    ];
  }, [query]);
  const suggestions = hits.slice(0, 8);
  const top = hits[0];

  const go = (hit: Hit) => navigate(entryPath(hit.kind, hit.card.slug));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && suggestions.length) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % suggestions.length); }
    else if (e.key === "ArrowUp" && suggestions.length) { e.preventDefault(); setOpen(true); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === "Enter" && suggestions.length) { e.preventDefault(); go(suggestions[Math.min(active, suggestions.length - 1)]!); }
    else if (e.key === "Escape") setOpen(false);
  };

  const starters = START.map((slug) => companyCards.find((c) => c.slug === slug)).filter((c): c is BankCard => Boolean(c));
  const showList = open && suggestions.length > 0;

  return (
    <BankShell kind="atlas">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Interview Atlas" }]} />
      <section aria-labelledby="atlas-title" className="pb-8 pt-8 sm:pt-12">
        <Eyebrow>Interview Atlas · free, no sign-up</Eyebrow>
        <h1 id="atlas-title" className="mk-display mt-4 max-w-4xl text-zinc-950 dark:text-white">
          Interview questions and processes for any company
        </h1>
        <p className="mk-lead mt-5 max-w-3xl text-zinc-600 dark:text-zinc-300">
          Search a company or a role to see how it interviews: the rounds candidates report, what interviewers listen
          for, and practice questions with what a good answer covers, alongside the company's open jobs. {companyCards.length} companies
          and {roleCards.length} roles, {sumQuestions([...companyCards, ...roleCards])} practice questions, each guide with the date it was last checked.
        </p>

        <div className="relative mt-8 max-w-2xl">
          <label htmlFor="atlas-search" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Company or role
          </label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" aria-hidden />
            <Input
              id="atlas-search"
              type="search"
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showList ? `${listId}-${active}` : undefined}
              value={text}
              onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={onKey}
              placeholder="Try “Netflix interview” or “data analyst”"
              autoComplete="off"
              maxLength={80}
              className="min-h-14 pl-11 text-base"
            />
          </div>
          {showList && (
            <ul id={listId} role="listbox" aria-label="Suggestions" className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border mk-line bg-white py-1 shadow-lg dark:bg-zinc-900">
              {suggestions.map((h, i) => (
                <li key={`${h.kind}:${h.card.slug}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); go(h); }} onMouseEnter={() => setActive(i)}
                  className={cx("flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm", i === active && "bg-zinc-100 dark:bg-white/10")}>
                  {h.kind === "company" ? <Building2 className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden /> : <GraduationCap className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-zinc-950 dark:text-white">{h.card.name} interview {h.kind === "company" ? "process and questions" : "questions"}</span>
                    <span className="block text-xs text-zinc-600 dark:text-zinc-400">{h.kind === "company" ? "Company" : "Role"} · {h.card.questions} practice questions</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p aria-live="polite" className="sr-only">{query ? `${hits.length} ${hits.length === 1 ? "guide" : "guides"} found` : ""}</p>
        </div>

        {!query && (
          <div className="mt-6">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Start with</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {starters.map((c) => (
                <li key={c.slug}>
                  <Link to={entryPath("company", c.slug)} className={cx("inline-flex min-h-10 items-center rounded-full border mk-line px-3.5 text-sm font-medium text-zinc-800 hover:border-[rgb(var(--site-line-strong))] dark:text-zinc-200", focusRing)}>
                    {c.name} interview
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {query && (
        <section aria-labelledby="atlas-results" className="pb-6">
          <h2 id="atlas-results" className="mk-h3 text-zinc-950 dark:text-white">
            {hits.length ? `Guides for “${text.trim()}”` : `No guide for “${text.trim()}” yet`}
          </h2>
          {!hits.length && (
            <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              You can still practise for it: a mock interview asks the usual questions for any company, from your resume and the job post.{" "}
              <Link to={companyMockLink({ name: query })} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                Practise for {text.trim()}
              </Link>
            </p>
          )}
          {top && <TopResult hit={top} />}
          {hits.length > 1 && (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {hits.slice(1, 13).map((h) => (
                <li key={`${h.kind}:${h.card.slug}`}>
                  <Link to={entryPath(h.kind, h.card.slug)} className={cx("flex h-full flex-col rounded-2xl border mk-line mk-surface p-4 hover:border-[rgb(var(--site-line-strong))]", focusRing)}>
                    <span className="font-semibold text-zinc-950 dark:text-white">{h.card.name} interview {h.kind === "company" ? "process and questions" : "questions"}</span>
                    <span className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{firstSentence(h.card.summary)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="atlas-companies" className="border-t mk-line py-10">
        <h2 id="atlas-companies" className="mk-h3 text-zinc-950 dark:text-white">Every company in the Atlas</h2>
        {COMPANY_GROUPS.map(([group, label]) => {
          const cards = inGroup(companyCards, group);
          return cards.length > 0 && (
            <div key={group} className="mt-6">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{label}</h3>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {cards.map((c) => (
                  <li key={c.slug}>
                    <Link to={entryPath("company", c.slug)} className={cx("rounded text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>{c.name} interview</Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <p className="mt-6 text-sm"><Link to={COMPANIES_PATH} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>Company guides with summaries <ArrowRight className="inline h-3.5 w-3.5" aria-hidden /></Link></p>
      </section>

      <section aria-labelledby="atlas-roles" className="border-t mk-line py-10">
        <h2 id="atlas-roles" className="mk-h3 text-zinc-950 dark:text-white">Every role in the Atlas</h2>
        {ROLE_GROUPS.map(([group, label]) => {
          const cards = inGroup(roleCards, group);
          return cards.length > 0 && (
            <div key={group} className="mt-6">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{label}</h3>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {cards.map((c) => (
                  <li key={c.slug}>
                    <Link to={entryPath("role", c.slug)} className={cx("rounded text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>{c.name} interview questions</Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <p className="mt-6 text-sm"><Link to={ROLES_PATH} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>Role guides with summaries <ArrowRight className="inline h-3.5 w-3.5" aria-hidden /></Link></p>
      </section>

      <FaqBlock id="atlas-faq" title="About Interview Atlas" items={ATLAS_FAQ} />
    </BankShell>
  );
}

/** The best match, with everything for it in one place: its guide, its open jobs and a free warm-up. */
function TopResult({ hit }: { hit: Hit }) {
  const { kind, card } = hit;
  const company = kind === "company";
  return (
    <article aria-labelledby="atlas-top" className="mt-5 rounded-2xl border mk-line mk-surface p-6">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{company ? "Company" : "Role"} · best match</p>
      <h3 id="atlas-top" className="mt-1 text-xl font-semibold text-zinc-950 dark:text-white">{card.name}</h3>
      <p className="mt-2 max-w-3xl text-sm text-zinc-700 dark:text-zinc-300">{firstSentence(card.summary, 260)}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link to={entryPath(kind, card.slug)} className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white dark:bg-white dark:text-zinc-950", focusRing)}>
          {company ? "Interview process and" : "The"} {card.questions} practice questions <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link to={warmupLink(kind, card.slug)} className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl border mk-line px-4 text-sm font-semibold text-zinc-900 dark:text-white", focusRing)}>
          <Target className="h-4 w-4" aria-hidden /> Warm up free on them
        </Link>
      </div>
      {company && <div className="mt-6 border-t mk-line pt-4"><CompanyJobs slug={card.slug} name={card.name} compact /></div>}
    </article>
  );
}
