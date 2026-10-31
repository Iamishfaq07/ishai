import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { BizCompany } from "@orbit/types";
import { ArrowRight, Button, Download, Search, Sparkles, cx, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { APP_HOME, companyPath } from "./model";
import { BUSINESS_TOOLS, ROLLOUT_GOALS, TOOL_GROUPS, canOpenTool, findTools, rolloutGoal, rolloutMarkdown, type BusinessTool, type ToolGroup } from "./productCatalog";

function destination(tool: BusinessTool, company?: BizCompany): string {
  return company ? companyPath(company.id, tool.path) : `${APP_HOME}?tool=${encodeURIComponent(tool.path)}`;
}

/** One catalog for the public page and the company launchpad; no company state is inferred from checkboxes. */
export function BusinessToolDirectory({ company }: { company?: BizCompany }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ToolGroup>("All tools");
  const tools = findTools(query, group);
  return <div>
    <div className="mt-8 flex flex-wrap items-end justify-between gap-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter Business tools">
        {TOOL_GROUPS.map(item => <Button key={item} variant={group === item ? "primary" : "secondary"} aria-pressed={group === item} onClick={() => setGroup(item)}>{item}</Button>)}
      </div>
      <label className="block w-full text-sm font-medium sm:w-72">Find a Business tool
        <span className="relative mt-2 block"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-500" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Try reviews, AI or talent" className={cx("min-h-11 w-full rounded-xl border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-950 dark:border-white/20 dark:bg-zinc-900 dark:text-white", focusRing)} /></span>
      </label>
    </div>
    <p role="status" className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">{tools.length} {tools.length === 1 ? "tool" : "tools"} found</p>
    <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {tools.map(tool => <li key={tool.path} className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 transition-colors duration-quick hover:border-indigo-400 dark:border-white/10 dark:bg-zinc-900/60">
        <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{tool.group}</p>
        <h3 className="mt-2 text-lg font-semibold text-zinc-950 dark:text-white">{tool.name}</h3>
        <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{tool.description}</p>
        {tool.ai && <p className="mt-4 flex items-start gap-2 text-xs text-indigo-700 dark:text-indigo-300"><Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />{tool.ai}</p>}
        {!company || canOpenTool(tool, company) ? <Link to={destination(tool, company)} className={cx("mt-5 inline-flex min-h-11 items-center gap-2 self-start rounded-lg text-sm font-medium text-indigo-700 dark:text-indigo-300", focusRing)}>Open {tool.name}<ArrowRight className="h-4 w-4 transition-transform duration-quick motion-ok:group-hover:translate-x-1" aria-hidden="true" /></Link> : <p className="mt-5 text-xs text-zinc-600 dark:text-zinc-400">Ask a company owner or admin about access for your role.</p>}
      </li>)}
    </ul>
    {!tools.length && <div className="mt-5 rounded-xl border border-dashed border-zinc-300 p-6 dark:border-white/20"><p>No tools match these filters.</p><Button className="mt-3" variant="secondary" onClick={() => { setQuery(""); setGroup("All tools"); }}>Reset tool filters</Button></div>}
    <p className="mt-5 text-xs text-zinc-600 dark:text-zinc-400">Availability follows your company role, plan and configured AI provider. AI drafts and summaries require human review.</p>
  </div>;
}

export function BusinessRolloutPlanner({ company }: { company?: BizCompany }) {
  const goalId = useId();
  const [search, setSearch] = useSearchParams();
  const goal = rolloutGoal(search.get("rollout"));
  const [checked, setChecked] = useState<string[]>([]);
  const complete = goal.steps.filter((_, index) => checked.includes(`${goal.id}:${index}`)).length;
  return <div className="mt-8 grid gap-5 lg:grid-cols-3">
    <div className="rounded-2xl bg-zinc-950 p-6 text-white">
      <p className="text-sm text-indigo-300">Your next Business workflow</p>
      <h3 className="mt-3 font-display text-2xl font-semibold">Choose a goal. Leave with a plan.</h3>
      <p className="mt-4 text-sm leading-relaxed text-zinc-300">A curated checklist with suggested owners, completion criteria and links to the right tools.</p>
      <label htmlFor={goalId} className="mt-6 block text-sm font-medium">Rollout goal</label><select id={goalId} value={goal.id} onChange={e => { const next = new URLSearchParams(search); next.set("rollout", e.target.value); setSearch(next, { replace: true, preventScrollReset: true }); }} className={cx("mt-2 min-h-12 w-full rounded-xl border border-white/30 bg-zinc-900 px-3 text-sm text-white", focusRing)}>{ROLLOUT_GOALS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <Button className="mt-5 w-full" variant="secondary" onClick={() => downloadText(`orbit-business-${goal.id}-rollout.md`, rolloutMarkdown(goal, checked))}><Download className="h-4 w-4" aria-hidden="true" />Download checklist</Button>
      <p className="mt-4 text-xs leading-relaxed text-zinc-300">The URL keeps your goal. Checkmarks stay only in this page session and are included in your download. No model is called.</p>
    </div>
    <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-white/10 dark:bg-zinc-900/60 sm:p-6 lg:col-span-2">
      <h3 className="text-xl font-semibold">{goal.label}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{goal.summary}</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-sm font-medium">{complete} of {goal.steps.length} planning steps checked</p><Button size="sm" variant="ghost" disabled={!complete} onClick={() => setChecked(current => current.filter(key => !key.startsWith(`${goal.id}:`)))}>Reset this checklist</Button></div>
      <progress aria-label={`${goal.label} checklist progress`} value={complete} max={goal.steps.length} className="mt-2 h-2 w-full accent-indigo-600" />
      <ol className="mt-5 space-y-5">{goal.steps.map((step, index) => {
        const key = `${goal.id}:${index}`;
        const tool = BUSINESS_TOOLS.find(item => item.path === step.tool)!;
        return <li key={key} className="border-t border-zinc-200 pt-5 dark:border-white/10">
          <label className="flex items-start gap-3 font-medium"><input type="checkbox" checked={checked.includes(key)} onChange={e => { const active = e.target.checked; setChecked(current => active ? [...current, key] : current.filter(item => item !== key)); }} className={cx("mt-1 h-5 w-5 shrink-0 accent-indigo-600", focusRing)} /><span>{index + 1}. {step.task}</span></label>
          <div className="ml-8 mt-2 space-y-2 text-sm"><p className="text-indigo-700 dark:text-indigo-300">Suggested owner: {step.owner}</p><p className="leading-relaxed text-zinc-600 dark:text-zinc-300">Ready when: {step.done}</p>
            {!company || canOpenTool(tool, company) ? <Link to={destination(tool, company)} className={cx("inline-flex min-h-11 items-center gap-2 rounded-lg font-medium text-indigo-700 dark:text-indigo-300", focusRing)}>Open {tool.name}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link> : <p className="text-xs text-zinc-600 dark:text-zinc-400">Ask a company owner or admin to coordinate this step.</p>}
          </div>
        </li>;
      })}</ol>
      <p className="mt-5 border-t border-zinc-200 pt-4 text-xs leading-relaxed text-zinc-600 dark:border-white/10 dark:text-zinc-400">Checkmarks are self-reported planning notes. They do not verify setup, complete workflow tasks, approve requests or publish anything.</p>
    </div>
  </div>;
}
