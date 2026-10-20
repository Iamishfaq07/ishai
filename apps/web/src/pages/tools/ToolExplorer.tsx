import { Link, useSearchParams } from "react-router-dom";
import { MOCK_INTERVIEW_ENABLED, buttonClass, cx, focusRing } from "@orbit/ui";
import { PublicHeader } from "../../marketing/PublicHeader";
import { PublicFooter } from "../../marketing/PublicFooter";
import { useAuth } from "../../lib/auth";
import { filterTools, STAGES, type Stage, type Audience } from "./catalog";

/** Product-native graphics: no remote images, tracking pixels or animation dependency. */
function FlowGraphic({ stage }: { stage: number }) {
  return <svg viewBox="0 0 360 100" role="img" aria-label={`Career workflow, step ${stage + 1} selected`} className="h-24 w-full max-w-md">
    <path d="M45 50H315" stroke="currentColor" strokeWidth="2" className="text-indigo-200 dark:text-indigo-800" />
    {[45, 135, 225, 315].map((x, i) => <g key={x} className="motion-safe:transition-opacity motion-safe:duration-quick" opacity={i === stage ? 1 : 0.45}>
      <circle cx={x} cy="50" r="26" className={i === stage ? "fill-indigo-600 motion-safe:animate-pulse" : "fill-indigo-100 dark:fill-indigo-900"} />
      <rect x={x - 9} y="37" width="18" height="26" rx="3" fill="none" stroke={i === stage ? "white" : "#818cf8"} strokeWidth="2" />
      <path d={`M${x - 4} 46h8m-8 6h8m-8 6h4`} stroke={i === stage ? "white" : "#818cf8"} strokeWidth="2" />
    </g>)}
  </svg>;
}

export function ToolExplorerPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const audience: Audience = params.get("audience") === "business" ? "business" : "personal";
  const stage: Stage | "all" = STAGES.some((s) => s.id === params.get("stage")) ? params.get("stage") as Stage : "all";
  const query = params.get("q") ?? "";
  const kind = ["ai", "automation"].includes(params.get("kind") ?? "") ? params.get("kind")! : "all";
  const update = (key: string, value: string) => {
    // Router transitions can still be rendering the last query. Compose fast edits from the current address.
    const next = new URLSearchParams(window.location.search);
    if (value && value !== "all") next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const clear = () => setParams({ audience: new URLSearchParams(window.location.search).get("audience") === "business" ? "business" : "personal" }, { replace: true });
  const tools = filterTools(audience, query, stage, kind).filter((tool) => tool.id !== "saba" || MOCK_INTERVIEW_ENABLED);
  const active = Math.max(0, STAGES.findIndex((s) => s.id === stage));
  return <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-white">
    <PublicHeader />
    <main id="main-content" className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6">
      <header className="grid items-center gap-6 rounded-3xl border border-indigo-200 bg-white p-6 sm:p-8 md:grid-cols-2 dark:border-indigo-500/20 dark:bg-zinc-900">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Explore Orbit</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Find your next move.</h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">A connected workspace for finding a role or building a team. Choose a step to discover the tools that help.</p>
          <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Tool audience">{(["personal", "business"] as const).map((a) => <button key={a} type="button" aria-pressed={a === audience} className={buttonClass(a === audience ? "primary" : "secondary", "md")} onClick={() => update("audience", a)}>{a === "personal" ? "Personal Orbit" : "Orbit for Business"}</button>)}</div>
        </div>
        <div className="rounded-2xl bg-indigo-50 p-5 dark:bg-indigo-500/5"><FlowGraphic stage={active} />
          <p className="text-center text-sm font-medium">{audience === "personal" ? "Your experience → Your next role" : "Your open role → Your next teammate"}</p>
          <p className="mt-2 text-center text-xs text-zinc-500">Explore the steps below. Progress is recorded inside your workspace.</p>
        </div>
      </header>
      <section aria-label="Choose a workflow step" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((s, index) => <button key={s.id} type="button" aria-pressed={stage === s.id} onClick={() => update("stage", stage === s.id ? "all" : s.id)}
          className={cx("group rounded-2xl border p-4 text-left transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-1", stage === s.id ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-zinc-200 bg-white hover:border-indigo-300 dark:border-white/10 dark:bg-zinc-900", focusRing)}>
          <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">0{index + 1}</span><span className="ml-2 font-semibold">{s.label}</span>
          <span className="mt-2 block text-sm text-zinc-500">{s[audience]}</span>
        </button>)}
      </section>
      <section aria-label="Find a tool" className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-sm font-medium">Search tools
            <input type="search" value={query} onChange={(e) => update("q", e.target.value)} placeholder="Try resume, Workday, interview, automation…" className={cx("mt-2 block min-h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 dark:border-white/15 dark:bg-zinc-900", focusRing)} />
          </label>
          <div className="text-sm font-medium"><label htmlFor="tool-kind">Show</label>
            <select id="tool-kind" value={kind} onChange={(e) => update("kind", e.target.value)} className={cx("mt-2 block min-h-11 rounded-xl border border-zinc-300 bg-white px-3 dark:border-white/15 dark:bg-zinc-900", focusRing)}><option value="all">All tools</option><option value="ai">AI features</option><option value="automation">Automations</option></select>
          </div>
          <button type="button" className={buttonClass("ghost", "md")} onClick={clear}>Clear filters</button>
        </div>
        <p className="text-sm text-zinc-500" role="status">{tools.length} tools · {audience === "personal" ? "Personal" : "Business"}{stage !== "all" ? ` · ${STAGES.find((s) => s.id === stage)?.label}` : ""}</p>
        {audience === "business" && <p className="text-sm text-zinc-600 dark:text-zinc-400">Choose your company after opening a tool. Available actions depend on your company role and plan.</p>}
        {tools.length === 0 ? <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center"><h2 className="font-semibold">No tools match these filters</h2><p className="mt-2 text-sm text-zinc-500">Try a shorter search or clear the workflow step.</p></div> :
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{tools.map((tool, i) => <article key={tool.id} className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-lg motion-safe:transition-transform motion-safe:hover:-translate-y-1 dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2"><span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{tool.automation ? "Automation" : tool.ai ? "AI assisted" : "Workspace"}</span></div>
            <h2 className="mt-4 text-lg font-semibold">{tool.name}</h2><p className="mt-2 text-sm font-medium">{tool.line}</p><p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{tool.detail}</p>
            <Link to={tool.href} state={!user ? { from: tool.href } : undefined} className={buttonClass("secondary", "md", "mt-5 w-full")}>{tool.label} <span aria-hidden="true" className="motion-safe:transition-transform motion-safe:group-hover:translate-x-1">→</span></Link>
          </article>)}</div>}
      </section>
      <aside className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm dark:border-white/10 dark:bg-zinc-900"><h2 className="font-semibold">Where should I start?</h2><p className="mt-2 text-zinc-500">{audience === "personal" ? "Start with your resume, save a few good matches, then configure your application agent. Keep the action desk nearby for anything that needs you." : "Start with a verified company and a role. Add your team, agree on interview criteria, then configure the reminders your hiring process needs."}</p>
        <Link to={audience === "personal" ? "/jobs/journey" : "/business/app"} className={buttonClass("primary", "md", "mt-4")}>{audience === "personal" ? "Open your application agent" : "Open your business workspace"}</Link>
      </aside>
    </main><PublicFooter />
  </div>;
}
