import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Briefcase, Check, Layers, ShieldCheck, Sparkles, Users, buttonClass, cx, focusRing } from "@orbit/ui";
import { Section, SectionIntro } from "../marketing/primitives";
import { BusinessRolloutPlanner, BusinessToolDirectory } from "./BusinessRollout";
import { APP_HOME } from "./model";
import { ROLLOUT_GOALS } from "./productCatalog";

/** Original vector artwork. The surrounding HTML gives the same product story without depending on the image. */
export function BusinessSystemArt() {
  return <div className="relative rounded-3xl border border-indigo-200 bg-indigo-50 p-3 shadow-xl shadow-indigo-950/10 dark:border-indigo-400/20 dark:bg-zinc-900 sm:p-5">
    <div className="flex items-center justify-between gap-3 px-2 pb-4 text-xs"><span className="flex items-center gap-2 font-medium text-indigo-900 dark:text-indigo-200"><span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />Connected hiring workspace</span><span className="rounded-full border border-indigo-200 px-2 py-1 text-indigo-800 dark:border-indigo-400/30 dark:text-indigo-200">Illustrative preview</span></div>
    <div className="overflow-hidden rounded-2xl bg-zinc-950 p-4 text-white sm:p-6" aria-hidden="true" inert>
      <div className="flex items-center justify-between"><span className="text-xs text-zinc-300">Orbit / Business</span><Layers className="h-5 w-5 text-indigo-300" /></div>
      <div className="relative mx-auto max-w-md">
        <svg viewBox="0 0 480 260" className="w-full" fill="none">
          <defs><radialGradient id="business-system-glow"><stop stopColor="#6366f1" stopOpacity=".35" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" /></radialGradient><pattern id="business-system-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#3f3f46" /></pattern></defs>
          <rect width="480" height="260" fill="url(#business-system-grid)" /><ellipse cx="240" cy="130" rx="170" ry="125" fill="url(#business-system-glow)" />
          <g stroke="#818cf8" strokeWidth="1.5"><path d="M90 65H160Q180 65 180 85V110H216M390 65H320Q300 65 300 85V110H264M90 195H160Q180 195 180 175V150H216M390 195H320Q300 195 300 175V150H264" strokeDasharray="5 5" /><circle cx="240" cy="130" r="67" strokeOpacity=".3" /><circle cx="240" cy="130" r="45" strokeOpacity=".5" /></g>
          <g className="origin-center motion-ok:animate-scale-in"><rect x="214" y="104" width="52" height="52" rx="17" fill="#4f46e5" /><circle cx="240" cy="130" r="14" stroke="white" strokeWidth="2" /><ellipse cx="240" cy="130" rx="23" ry="8" stroke="white" strokeWidth="1.5" transform="rotate(-35 240 130)" /></g>
          {[[90, 65, "Plan"], [390, 65, "Attract"], [90, 195, "Coordinate"], [390, 195, "Learn"]].map(([x, y, label]) => <g key={label} className="motion-ok:animate-fade-up"><rect x={Number(x) - 57} y={Number(y) - 20} width="114" height="40" rx="12" fill="#18181b" stroke="#52525b" /><text x={x} y={Number(y) + 5} textAnchor="middle" fill="#e4e4e7" fontSize="14" fontFamily="inherit">{label}</text></g>)}
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-indigo-300">Independent review</p><p className="mt-2 text-sm font-medium">Evidence ready to inspect</p><div className="mt-3 flex items-center gap-2 text-xs text-zinc-300"><ShieldCheck className="h-4 w-4 text-emerald-300" />A named person decides</div></div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-indigo-300">AI assistance</p><p className="mt-2 text-sm font-medium">Draft. Review. Use.</p><div className="mt-3 flex items-center gap-2 text-xs text-zinc-300"><Sparkles className="h-4 w-4 text-indigo-300" />Sources stay visible</div></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-300">{["Role-scoped access", "Review history", "Internal follow-ups"].map(label => <span key={label} className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1.5"><Check className="h-3 w-3 text-emerald-300" />{label}</span>)}</div>
    </div>
  </div>;
}

const TOUR_ICONS = [Briefcase, Layers, Users, BookOpen];

export function BusinessProductShowcase() {
  const [selected, setSelected] = useState(0);
  const goal = ROLLOUT_GOALS[selected]!;
  const Icon = TOUR_ICONS[selected]!;
  return <>
    <Section id="business-tour" labelledBy="business-tour-title" band>
      <SectionIntro id="business-tour-title" eyebrow="The connected Business toolkit" title="More than a pipeline. A way to work together." lead="Bring hiring requests, team playbooks, talent communities and policy knowledge into one company workspace. Explore a workflow to see where each tool fits." />
      <div className="mt-8 flex flex-wrap gap-2" role="group" aria-label="Explore Business workflows">{ROLLOUT_GOALS.map((item, index) => <button key={item.id} type="button" aria-pressed={selected === index} aria-controls="business-tour-scene" onClick={() => setSelected(index)} className={buttonClass(selected === index ? "primary" : "secondary", "md")}>{item.label}</button>)}</div>
      <div id="business-tour-scene" className="mt-6 overflow-hidden rounded-3xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-zinc-900">
        <div key={goal.id} className="grid animate-fade-in lg:grid-cols-2">
          <div className="p-6 sm:p-9"><span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300"><Icon className="h-6 w-6" aria-hidden="true" /></span><h3 className="mt-6 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{goal.headline}</h3><p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-300">{goal.summary}</p>
            <ol className="mt-6 space-y-4">{goal.steps.map((step, index) => <li key={step.task} className="flex items-start gap-3 text-sm"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">{index + 1}</span><span><strong className="font-medium">{step.task}</strong><span className="mt-1 block text-zinc-600 dark:text-zinc-400">{step.owner}</span></span></li>)}</ol>
            <Link to={`?rollout=${goal.id}#business-rollout`} preventScrollReset onClick={() => document.getElementById("business-rollout")?.scrollIntoView({ block: "start" })} className={cx("mt-7 inline-flex min-h-11 items-center gap-2 rounded-lg font-medium text-indigo-700 dark:text-indigo-300", focusRing)}>Build this rollout plan<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
          <div className="relative flex min-h-80 items-center justify-center overflow-hidden bg-zinc-950 px-5 py-10 sm:px-9" aria-hidden="true" inert>
            <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" fill="none"><circle cx="200" cy="200" r="135" stroke="#6366f1" strokeOpacity=".4" /><circle cx="200" cy="200" r="185" stroke="#6366f1" strokeOpacity=".2" /><path d="M0 200H400M200 0V400" stroke="#a5b4fc" strokeOpacity=".1" /></svg>
            <div className="relative w-full max-w-sm space-y-3"><div className="mb-5 flex items-center justify-between text-xs text-zinc-300"><span>{goal.label}</span><span className="rounded-full border border-white/20 px-2 py-1">Workflow illustration</span></div>{goal.steps.map((step, index) => <div key={step.task} className="group flex items-center gap-3 rounded-xl border border-white/15 bg-zinc-900 p-4 transition-transform duration-panel motion-ok:hover:-translate-y-1"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-sm font-semibold text-indigo-200">0{index + 1}</span><div className="min-w-0"><p className="text-sm font-medium text-white">{step.task}</p><p className="mt-1 text-xs text-zinc-400">{step.owner}</p></div><ArrowRight className="ml-auto h-4 w-4 shrink-0 text-indigo-300" /></div>)}<p className="pt-3 text-xs leading-relaxed text-zinc-400">Illustrative sequence · setup and decisions are completed by your team</p></div>
          </div>
        </div>
      </div>
    </Section>

    <Section id="business-ai" labelledBy="business-ai-title">
      <SectionIntro id="business-ai-title" eyebrow="AI with a review step" title="Help with the work around the decision." lead="Use AI to prepare and summarize. Keep approvals, publishing and hiring decisions with your team." />
      <div className="mt-10 grid gap-5 md:grid-cols-3">{[
        { icon: Sparkles, title: "Prepare the first draft", text: "Draft a role or a playbook from a brief. Review the wording and responsibilities before saving or starting work.", detail: "Job drafts · Playbook drafts" },
        { icon: BookOpen, title: "Bring the source along", text: "Inspect resume evidence and exact knowledge quotes. Check whether the source supports an answer before using it.", detail: "Evidence ranking · Cited policy answers" },
        { icon: ShieldCheck, title: "See what needs attention", text: "Prepare progress briefs from workflow signals, including overdue or paused reviews. Review aggregate feedback without adding individual responses to the prompt.", detail: "Progress briefs · Feedback summaries" },
      ].map(card => <article key={card.title} className="group rounded-2xl border border-zinc-200 p-6 transition-colors duration-quick hover:border-indigo-400 dark:border-white/10"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 transition-transform duration-panel motion-ok:group-hover:-translate-y-1 dark:bg-indigo-400/10 dark:text-indigo-300"><card.icon className="h-6 w-6" aria-hidden="true" /></div><h3 className="mt-5 text-xl font-semibold">{card.title}</h3><p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{card.text}</p><p className="mt-5 border-t border-zinc-200 pt-4 text-xs font-medium text-indigo-700 dark:border-white/10 dark:text-indigo-300">{card.detail}</p></article>)}</div>
    </Section>

    <Section id="business-tools" labelledBy="business-tools-title" band><SectionIntro id="business-tools-title" eyebrow="Discover the tools" title="Find the workspace for your next step." lead="Search the Business toolkit or browse by the work your team wants to do. Each tool opens through your company chooser." /><BusinessToolDirectory /></Section>
    <Section id="business-rollout" labelledBy="business-rollout-title"><SectionIntro id="business-rollout-title" eyebrow="Try the rollout planner" title="Turn the toolkit into a team plan." lead="Choose a goal, work through a practical checklist and download the plan. No account is needed to plan; sign in when you’re ready to set up the tools." /><BusinessRolloutPlanner /><Link to={`${APP_HOME}?tool=launchpad`} className={cx("mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg font-medium text-indigo-700 dark:text-indigo-300", focusRing)}>Open your company launchpad<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Section>
  </>;
}
