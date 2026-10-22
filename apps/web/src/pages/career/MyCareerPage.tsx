import { Link } from "react-router-dom";
import type { CandidateIdentity } from "@orbit/types";
import {
  BadgeCheck, BookOpen, Briefcase, CreditCard, Database, FileText, Gauge, IdCard, LockKeyhole, Reveal,
  Search, Target, Users, Wallet, cx, focusRing, useInView,
  Wand2, Route,
  Code2,
} from "@orbit/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useAsync } from "../../lib/useAsync";
import { linkButton } from "../jobs/links";
import { Stat, Tool, type ToolCard } from "../prepare/parts";
import { CareerIdentity } from "./CareerIdentity";
import { MoreTools } from "../tools/MoreTools";

const identityPath = "/v1/jobs/launchpad/identity";

interface Step { label: string; done: boolean; to: string; action: string }

/** Setup steps from the candidate's own records. A checklist of what's in place, not a readiness score. */
export function setupSteps(identity: CandidateIdentity | null | undefined, stories: number | null, contacts: number | null,
                           linkedin: boolean | null): Step[] {
  const steps: (Step | null)[] = [
    { label: "Choose a master resume", done: Boolean(identity?.master), to: "/resume-ai?start=import&guide=1", action: "Choose" },
    { label: "Review its facts", done: identity?.review === "reviewed", to: identity?.master ? `/resume-ai/${encodeURIComponent(identity.master.id)}?guide=1` : "/resume-ai", action: "Review" },
    { label: "Set target roles and locations", done: Boolean(identity?.target_roles.length), to: "/jobs/profile", action: "Set" },
    stories === null ? null : { label: "Save three stories", done: stories >= 3, to: "/documents/stories", action: "Add" },
    linkedin === null ? null : { label: "Bring in your LinkedIn profile", done: linkedin, to: "/linkedin", action: "Import" },
    contacts === null ? null : { label: "Save a first contact", done: contacts > 0, to: "/jobs/outreach?network=1", action: "Add" },
  ];
  return steps.filter((s): s is Step => s !== null);
}

/** A thin progress bar that fills from zero when it first scrolls into view (motion-safe). */
function Progress({ done, total }: { done: number; total: number }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return <div ref={ref} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`${done} of ${total} set up`}
    className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10">
    <div className="h-full rounded-full bg-indigo-600 motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out" style={{ width: `${inView ? pct : 0}%` }} />
  </div>;
}

/**
 * My Career: who you are on paper and where you're heading. Setup checklist, the master resume and direction
 * (CareerIdentity), and every profile, search and account tool in view. Numbers are the candidate's own records.
 */
export function MyCareerPage() {
  const { user } = useAuth();
  const identity = useAsync(() => api.call<CandidateIdentity>(identityPath), [user?.id], `candidate-identity:${user?.id}`);
  const stories = useAsync(() => api.listStories(), [], "stories");
  const contacts = useAsync(() => api.jobContacts(), [], "job-contacts");
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const linkedin = useAsync(() => api.linkedin(), [], "linkedin");
  const steps = setupSteps(identity.data, stories.data ? stories.data.length : stories.error ? null : 0,
    contacts.data ? contacts.data.length : contacts.error ? null : 0,
    linkedin.data ? Boolean(linkedin.data.profile) : linkedin.error ? null : false);
  const done = steps.filter((s) => s.done).length;
  const loading = !identity.data && !identity.error;

  const groups: { title: string; about: string; items: ToolCard[] }[] = [
    { title: "My experience", about: "The facts every application and answer is built from.", items: [
      { title: "Resume Studio", detail: "Build, import or edit one section at a time, with ATS checks.", icon: FileText, to: "/resume-ai", ai: true },
      { title: "Story bank", detail: "Truthful examples from your work, reused in interviews.", icon: BookOpen, to: "/documents/stories" },
      { title: "Source documents", detail: "The files you choose to let Orbit read.", icon: Database, to: "/documents" },
      ...(user?.evidence_vault ? [{ title: "Evidence", detail: "The sources behind each claim you make.", icon: BadgeCheck, to: "/documents/evidence" }] : []),
      { title: "LinkedIn profile", detail: "Import, score and review headline and About suggestions.", icon: IdCard, to: "/linkedin", ai: true },
      { title: "GitHub projects", detail: "Public repositories turned into resume projects, skills and stories.", icon: Code2, to: "/github-projects" },
      { title: "Bullet builder", detail: "Turn what you did into a resume line: result, number, and how.", icon: Wand2, to: "/bullet-builder" },
      { title: "Career gap explainer", detail: "An honest resume line and a 30-second answer for a break.", icon: Route, to: "/career-gap" },
    ] },
    { title: "My search", about: "Where you're heading and who can help.", items: [
      { title: "Search preferences", detail: "Target roles, locations, work mode and the resume search uses.", icon: Target, to: "/jobs/profile" },
      { title: "Contacts & outreach", detail: "People you've saved, research leads and reviewed drafts.", icon: Users, to: "/jobs/outreach?network=1", ai: true },
      { title: "Offers & decisions", detail: "Compare offers, in-hand pay and practise the negotiation.", icon: Wallet, to: "/offers", ai: true },
      { title: "Weekly progress", detail: "Your recorded activity, targets and an AI experiment for next week.", icon: Gauge, to: "/jobs/weekly", ai: true },
    ] },
    { title: "Account & privacy", about: "Your data, your sessions, your plan.", items: [
      { title: "Settings & privacy", detail: "Sessions, permissions, export and account deletion.", icon: LockKeyhole, to: "/settings" },
      { title: "Credits & usage", detail: "Your plan, AI usage and purchase history.", icon: CreditCard, to: "/billing" },
    ] },
  ];

  return <div className="workspace-page">
    <header className="workspace-heading">
      <div><p className="workspace-eyebrow">Your career profile</p><h1>My Career</h1>
        <p className="workspace-description">Your resume, stories and direction in one place. Everything you apply and interview with starts here.</p></div>
      <div className="flex flex-wrap gap-2">
        <Link to="/jobs/profile" className={linkButton("secondary")}><Search className="h-4 w-4" aria-hidden /> Search preferences</Link>
        <Link to={identity.data?.master ? `/resume-ai/${encodeURIComponent(identity.data.master.id)}` : "/resume-ai"} className={linkButton("primary")}><FileText className="h-4 w-4" aria-hidden /> Open Resume Studio</Link>
      </div>
    </header>

    <Reveal stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Resumes" value={resumes.data ? resumes.data.length : null} hint="Master and job copies" />
      <Stat label="Stories" value={stories.data ? stories.data.length : null} hint="Ready for interviews" />
      <Stat label="Contacts" value={contacts.data ? contacts.data.length : null} hint="People you've saved" />
      <Stat label="Skills on resume" value={identity.data ? identity.data.skills.length : null} hint="From your master resume" />
    </Reveal>

    {!loading && <Reveal as="section" aria-labelledby="setup" className="workspace-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="setup" className="font-display text-xl font-semibold">{done === steps.length ? "Your profile is set up" : "Finish setting up your profile"}</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{done} of {steps.length} in place. Each one makes matches, tailoring and interview prep use your real experience.</p></div>
      </div>
      <div className="mt-4"><Progress done={done} total={steps.length} /></div>
      <Reveal as="ol" stagger className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{steps.map((s) => <li key={s.label}>
        <Link to={s.to} className={cx("group flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-sm motion-safe:transition-colors", s.done
          ? "border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-100"
          : "border-zinc-200 hover:border-indigo-400 dark:border-white/10", focusRing)}>
          <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", s.done ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-300 dark:bg-white/10 dark:text-zinc-300 dark:ring-white/15")} aria-hidden>{s.done ? "✓" : ""}</span>
          <span className="flex-1">{s.label}<span className="sr-only">{s.done ? " (done)" : " (to do)"}</span></span>
          {!s.done && <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{s.action}</span>}
        </Link></li>)}</Reveal>
    </Reveal>}

    {user && <CareerIdentity key={user.id} userId={user.id} />}

    {groups.map((g) => <section key={g.title} aria-labelledby={`grp-${g.title}`}>
      <h2 id={`grp-${g.title}`} className="font-semibold">{g.title}</h2>
      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{g.about}</p>
      <Reveal as="ul" stagger className="-mx-3 mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">{g.items.map((t) => <li key={t.title}><Tool t={t} /></li>)}</Reveal>
    </section>)}

    <MoreTools home="career" shown={[...groups.flatMap((g) => g.items.map((t) => t.to)), "/resume-ai"]} />

    <section aria-labelledby="next-move" className="workspace-panel flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"><Briefcase className="h-4 w-4" aria-hidden /></span>
        <div><h2 id="next-move" className="font-semibold">Put your profile to work</h2>
          <p className="mt-0.5 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">Matches, tailored resumes and auto-apply all start from the master resume and preferences above.</p></div></div>
      <div className="flex flex-wrap gap-2"><Link to="/jobs/matches" className={linkButton("secondary")}>Discover jobs</Link><Link to="/prepare" className={linkButton("ghost")}>Prepare for interviews</Link></div>
    </section>
  </div>;
}
