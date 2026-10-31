// /business: the connected company workspace, its workflow tours, tool directory and rollout planner. Built from
// the product pages' section kit (D79, D82), with the same content rendered as HTML and Markdown (src/prerender).
import { useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Briefcase, Building2, ChartColumn, ScrollText, ShieldCheck, Sparkles, Users, buttonClass } from "@orbit/ui";
import { BUSINESS_FAQ } from "../../worker/faqs/business.js";
import { FactsBand, FaqBlock, FinalCta, HeroShowcase, Panel, SampleTag, StepsWithUI, ToolkitGrid } from "../marketing/kit";
import { PublicLayout } from "../marketing/PublicLayout";
import { Section, SectionIntro } from "../marketing/primitives";
import { StickyCta } from "../marketing/StickyCta";
import { APP_HOME } from "./model";
import { BusinessProductShowcase, BusinessSystemArt } from "./BusinessShowcase";

const TO_APP = { from: APP_HOME };

function MiniCard({ name, score, match, flag }: { name: string; score: number; match: string; flag?: string }) {
  return (
    <div className="rounded-lg border mk-line bg-white p-2 text-[0.6875rem] dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
        <span className={`rounded-full px-1.5 font-semibold ${score >= 75 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-sky-50 text-sky-800 dark:bg-sky-400/10 dark:text-sky-200"}`}>{score}</span>
      </div>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">{match}</p>
      {flag && <p className="mt-0.5 text-amber-800 dark:text-amber-300">{flag}</p>}
    </div>
  );
}

/** The pipeline as the app draws it, with made-up applicants (it says so). Decorative: the words beside it say it. */
function PipelineArt() {
  const cols: Array<{ name: string; cards: Array<{ name: string; score: number; match: string; flag?: string }> }> = [
    { name: "Applied", cards: [{ name: "Candidate A-7F3K", score: 82, match: "Matches 7/8 must-haves" }, { name: "Candidate B-2M9Q", score: 64, match: "Matches 5/8 must-haves", flag: "Doesn't meet: notice period" }] },
    { name: "Screen", cards: [{ name: "Candidate C-4T1X", score: 77, match: "Matches 6/8 must-haves" }] },
    { name: "Interview", cards: [{ name: "Candidate D-9W2L", score: 88, match: "Matches 8/8 must-haves" }] },
  ];
  return (
    <div aria-hidden="true" inert>
      <Panel title="Backend Engineer · Bengaluru" meta={<SampleTag />}>
        <div className="grid grid-cols-3 gap-2 p-2.5">
          {cols.map((c) => (
            <div key={c.name} className="space-y-2 rounded-lg bg-zinc-50 p-2 dark:bg-white/[0.03]">
              <p className="text-[0.6875rem] font-semibold text-zinc-700 dark:text-zinc-200">
                {c.name} <span className="font-normal text-zinc-500">{c.cards.length}</span>
              </p>
              {c.cards.map((card) => (
                <MiniCard key={card.name} {...card} />
              ))}
            </div>
          ))}
        </div>
        <p className="border-t mk-line px-3 py-2 text-[0.6875rem] text-zinc-600 dark:text-zinc-400">Blind review on · a person decides every move</p>
      </Panel>
    </div>
  );
}

function EvidenceArt() {
  return (
    <div aria-hidden="true" inert className="space-y-1.5 text-[0.75rem]">
      {[
        ["Go or Python in production", "yes", "“Built payment APIs in Go serving 2M requests a day”"],
        ["PostgreSQL", "yes", "“Tuned Postgres queries, cut p95 by 40%”"],
        ["Kubernetes", "partly", "“Deployed services with Helm”"],
      ].map(([req, met, ev]) => (
        <p key={req}>
          <span className={met === "yes" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>{met === "yes" ? "Met" : "Partly"}</span>{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{req}</span>
          <span className="block text-zinc-600 dark:text-zinc-400">{ev}</span>
        </p>
      ))}
    </div>
  );
}

const PLANS = [
  { name: "Free", inr: "₹0", usd: "$0", lines: ["1 active job", "1 seat", "Careers page and Google for Jobs", "AI ranking with reasons"] },
  { name: "Starter", inr: "₹2,999", usd: "$39", lines: ["5 active jobs", "3 seats", "Email templates and scorecards", "Interview scheduling"] },
  { name: "Growth", inr: "₹9,999", usd: "$129", lines: ["20 active jobs", "10 seats", "Everything in Starter", "By invitation"] },
];

export function BusinessLandingPage() {
  const heroCtas = useRef<HTMLDivElement>(null);
  const finalCta = useRef<HTMLElement>(null);
  return (
    <PublicLayout authState={TO_APP} context="For Business">
      <HeroShowcase
        product={{ id: "business", name: "for Business", icon: Building2 }}
        title={["Your hiring team.", "One connected orbit."]}
        lead="Plan a role, build a talent community, coordinate reviews and put team knowledge to work. Orbit connects your hiring tools with AI drafts, visible evidence and workflows your team controls."
        ctas={heroCtas}
        actions={
          <>
            <Link to={APP_HOME} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Start hiring free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a href="#business-tour" className={buttonClass("secondary", "lg", "min-h-12 px-6")}>Explore the product</a>
          </>
        }
        note={
          <p>
            <strong className="font-medium text-zinc-900 dark:text-white">Free for one job and one seat.</strong> Your company is verified through its own domain before
            its jobs go live, which keeps fake employers out.
          </p>
        }
        honest="No automatic rejections: knock-out answers are flagged, and a person clicks Reject. Names and photos are never inputs to the ranking."
        visual={<BusinessSystemArt />}
      />

      <nav aria-label="On this Business page" className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-6 gap-y-2 px-5 pb-8 text-sm font-medium text-indigo-700 dark:text-indigo-300">
        {[["business-tour", "Product tour"], ["business-ai", "AI assistance"], ["business-tools", "All tools"], ["business-rollout", "Rollout planner"], ["plans-title", "Plans"]].map(([id, label]) => <a key={id} href={`#${id}`} className={buttonClass("ghost", "sm")}>{label}</a>)}
      </nav>

      <FactsBand
        label="Orbit for Business in numbers"
        facts={[
          { value: 0, label: "applicants rejected automatically, ever" },
          { value: 6, label: "default stages, editable per job" },
          { value: 12, label: "months before a rejected applicant's data is deleted, by default" },
          { value: 5, label: "roles, from Owner to Interviewer" },
        ]}
      />

      <BusinessProductShowcase />

      <StepsWithUI
        id="steps-title"
        eyebrow="How it works"
        title="From a brief to a hire, in one place."
        steps={[
          { title: "Verify and post", text: "Add your company, prove the domain with a work email or a DNS record, and write the job, or let Orbit draft it from a short brief.", ui: <Panel title="acme.com"><p className="p-3 text-xs text-emerald-700 dark:text-emerald-300" aria-hidden="true">Verified company</p></Panel> },
          { title: "Collect applications", text: "Your careers page, your own site's widget and Google for Jobs send people to one form. Orbit users apply in one click with a resume they choose.", ui: <Panel title="Apply"><p className="p-3 text-xs text-zinc-600 dark:text-zinc-400" aria-hidden="true">Resume, screening answers, consent</p></Panel> },
          { title: "Review together", text: "Ranked with reasons, flagged on knock-outs, moved through your stages with notes, @mentions and scorecards. Emails go out from Orbit with replies to you.", ui: <Panel title="Pipeline"><p className="p-3 text-xs text-zinc-600 dark:text-zinc-400" aria-hidden="true">Applied · Screen · Interview · Offer</p></Panel> },
        ]}
      />

      <ToolkitGrid
        id="toolkit-title"
        eyebrow="The toolkit"
        title="The hiring essentials, connected."
        band
        tools={[
          { title: "Ranking that shows its work", icon: Sparkles, text: "\"Matches 6 of 8 must-haves\", each with the line from the resume that shows it. It sorts; it never decides.", widget: <EvidenceArt />, wide: true },
          { title: "Careers page and Google for Jobs", icon: Briefcase, text: "Each open job is a page with JobPosting markup, in Orbit's sitemap, and taken out when the job closes.", widget: <p aria-hidden="true" className="text-xs text-zinc-600 dark:text-zinc-400">orbitanswer.com/company/acme</p> },
          { title: "Board and list", icon: ChartColumn, text: "Drag or use the keyboard to move applicants, select many to move or reject at once, tag and search.", widget: <PipelineArt />, wide: true },
          { title: "Team, scorecards and scheduling", icon: Users, text: "Five roles, a 1-4 rubric per stage with hire or no hire, and interview times the applicant picks, with a calendar invite.", widget: <p aria-hidden="true" className="text-xs text-zinc-600 dark:text-zinc-400">Owner · Admin · Recruiter · Hiring manager · Interviewer</p> },
          { title: "Data controls and audit log", icon: ScrollText, text: "Retention you set, delete on request, CSV export, and a log of every move and every ranking's model version.", widget: <p aria-hidden="true" className="text-xs text-zinc-600 dark:text-zinc-400">Rejected: deleted after 12 months</p> },
        ]}
      />

      <Section labelledBy="plans-title">
        <SectionIntro id="plans-title" eyebrow="Plans" title="Start free. Grow when you hire more." lead="Prices per month. Growth is by invitation while we onboard companies one by one. Saba screening uses your saved interview plan, with transcripts for your hiring team to review." />
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <li key={p.name} className="rounded-2xl border mk-line mk-surface p-6">
              <h3 className="mk-h3 text-zinc-950 dark:text-white">{p.name}</h3>
              <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-white">
                {p.inr} <span className="text-base font-normal text-zinc-500">/ {p.usd} a month</span>
              </p>
              <ul className="mt-4 space-y-1.5 text-[0.9375rem] text-zinc-700 dark:text-zinc-300">
                {p.lines.map((l) => (
                  <li key={l} className="flex gap-2">
                    <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    {l}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">Rupee prices are before GST. Applicants never pay anything.</p>
      </Section>

      <FaqBlock id="faq-title" items={BUSINESS_FAQ} />

      <Section labelledBy="seekers-title">
        <SectionIntro
          id="seekers-title"
          eyebrow="Looking for a job?"
          title="Orbit is free for job seekers."
          lead={
            <>
              <Link to="/jobs" className="underline">
                Jobs
              </Link>{" "}
              finds openings, and{" "}
              <Link to="/resume-ai" className="underline">
                Resume
              </Link>{" "}
              gets the resume ready. A company never sees your Orbit unless you apply to it.
            </>
          }
        />
      </Section>

      <FinalCta
        id="cta-title"
        innerRef={finalCta}
        title={["Post your first job free.", "A person always decides."]}
        text="Create your company, verify its domain and publish a job with its own careers page in a few minutes."
        primary={{ to: APP_HOME, label: "Start hiring free" }}
        secondary={{ to: "/register", label: "Create an account", state: TO_APP }}
        footnote="The ranking reads professional information only. Rejecting always takes a person's click."
      />
      <StickyCta after={heroCtas} before={finalCta} line="Your hiring team. One connected orbit." />
    </PublicLayout>
  );
}
