import { useId } from "react";
import { ArrowRight, BookOpen, Briefcase, Layers, ShieldCheck, Users, buttonClass, cx, focusRing } from "@orbit/ui";
import { Link } from "react-router-dom";
import { useCompany } from "./BusinessApp";
import { companyPath } from "./model";

/** Original decorative artwork; these nodes describe a workflow, never a completion or live-data state. */
function WorkspaceIllustration() {
  const id = useId().replaceAll(":", "");
  return <svg viewBox="0 0 420 240" fill="none" className="w-full max-w-sm" aria-hidden="true">
    <defs><radialGradient id={id}><stop stopColor="#6366f1" stopOpacity=".25" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" /></radialGradient></defs>
    <ellipse cx="210" cy="120" rx="195" ry="115" fill={`url(#${id})`} /><g stroke="#818cf8" strokeOpacity=".4"><ellipse cx="210" cy="120" rx="160" ry="75" transform="rotate(-15 210 120)" /><ellipse cx="210" cy="120" rx="160" ry="75" transform="rotate(15 210 120)" /><path d="M78 69L210 120L341 70M78 174L210 120L341 174" strokeDasharray="4 5" /></g>
    <g className="motion-ok:animate-scale-in"><rect x="179" y="89" width="62" height="62" rx="20" fill="#4f46e5" /><circle cx="210" cy="120" r="17" stroke="white" strokeWidth="2" /><ellipse cx="210" cy="120" rx="27" ry="9" transform="rotate(-35 210 120)" stroke="white" strokeWidth="1.5" /></g>
    {[[78, 69, "Plan"], [341, 70, "Review"], [78, 174, "Knowledge"], [341, 174, "Team"]].map(([x, y, label]) => <g key={label} className="motion-ok:animate-fade-up"><rect x={Number(x) - 53} y={Number(y) - 19} width="106" height="38" rx="12" fill="#18181b" stroke="#52525b" /><text x={x} y={Number(y) + 5} textAnchor="middle" fontSize="13" fill="#e4e4e7" fontFamily="inherit">{label}</text></g>)}
  </svg>;
}

export function BusinessWorkspaceHero({ kind = "dashboard" }: { kind?: "dashboard" | "launchpad" }) {
  const { company } = useCompany();
  const launchpad = kind === "launchpad";
  return <section aria-label={launchpad ? "Business rollout introduction" : "Business workspace introduction"} className="relative isolate overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 text-white">
    <div className="grid items-center gap-4 p-6 sm:p-8 xl:grid-cols-5">
      <div className="min-w-0 xl:col-span-3"><p className="text-xs font-medium text-indigo-300">{launchpad ? "Your team’s next chapter" : "Your company, connected"}</p><h2 className="mt-3 max-w-xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">{launchpad ? "A plan for the work ahead." : "Build a clearer hiring rhythm."}</h2><p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-300">{launchpad ? "Choose a rollout goal, explore your tools and agree on the next steps with your team." : "Bring role preparation, evidence review and team knowledge into one workspace. Start with the next step your team needs."}</p>
        <div className="mt-6 flex flex-wrap gap-3"><Link to={companyPath(company.id, launchpad ? "jobs" : "launchpad")} className={buttonClass("primary", "md")}>{launchpad ? "Open your jobs" : "Plan your next rollout"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>{company.permissions.move_applicants && <Link to={companyPath(company.id, "workflow-reviews")} className={cx("inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-indigo-200 hover:text-white", focusRing)}>Open review inbox<ShieldCheck className="h-4 w-4" aria-hidden="true" /></Link>}</div>
      </div>
      <div className="mx-auto hidden w-full max-w-sm xl:col-span-2 xl:block"><WorkspaceIllustration /><p className="text-center text-xs text-zinc-300">Plan · review · learn · coordinate</p></div>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 px-6 py-4 text-xs text-zinc-300 sm:px-8"><span className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />Company workspace</span><span className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />Role-scoped tools</span><span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />People make decisions</span></div>
  </section>;
}

export function BusinessWorkspaceShortcuts() {
  const { company } = useCompany();
  const cards = [
    { to: "jobs", title: "Prepare your next role", text: "Review requirements and work with applicants in the shared pipeline.", icon: Briefcase },
    ...(company.permissions.move_applicants ? [{ to: "workflow-studio", title: "Coordinate the handoffs", text: "Give your playbook steps owners, prerequisites and independent reviews.", icon: Layers }] : []),
    { to: "knowledge-reading", title: "Keep the team aligned", text: "Read the current published policies and record your acknowledgments.", icon: BookOpen },
  ];
  return <section aria-labelledby="workspace-shortcuts-title"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="workspace-shortcuts-title" className="text-base font-semibold">Where would you like to work?</h2><span className="text-xs text-zinc-500 dark:text-zinc-400">Tools for your team</span></div><ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{cards.map(card => <li key={card.to}><Link to={companyPath(company.id, card.to)} className={cx("group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-5 transition-colors duration-quick hover:border-indigo-400 dark:border-white/10 dark:bg-zinc-900/60", focusRing)}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 transition-transform duration-panel motion-ok:group-hover:-translate-y-1 dark:bg-indigo-400/10 dark:text-indigo-300"><card.icon className="h-5 w-5" aria-hidden="true" /></span><h3 className="mt-4 font-semibold">{card.title}</h3><p className="mb-4 mt-2 flex-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{card.text}</p><span className="inline-flex items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">Open workspace<ArrowRight className="h-4 w-4 transition-transform duration-quick motion-ok:group-hover:translate-x-1" aria-hidden="true" /></span></Link></li>)}</ul></section>;
}
