import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Field, Input, cx, focusRing } from "@orbit/ui";
import { findJobTools, JOB_WORKSPACES } from "./workspace";

export default function ToolFinder({ onNavigate }: { onNavigate: () => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const results = findJobTools(query);
  return <section id="jobs-tool-finder" aria-label="Find a Jobs AI tool" className="space-y-4 rounded-2xl border border-zinc-200 p-4 dark:border-white/10">
    <Field htmlFor={id} label="What do you want to do?" hint="Try interview, contacts, auto-apply or the name of an old tab.">
      <Input id={id} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
    </Field>
    <p role="status" className="text-xs text-zinc-600 dark:text-zinc-400">{results.length} {results.length === 1 ? "tool" : "tools"} found</p>
    {!results.length && <p className="text-sm">No matching tools. Try “resume”, “messages” or “weekly”.</p>}
    <ul className="grid gap-2 sm:grid-cols-2">{results.map((tool) => <li key={tool.to}>
      <Link to={tool.to} onClick={onNavigate} className={cx("group flex h-full items-center gap-3 rounded-xl border border-zinc-200 p-3 transition-colors hover:border-indigo-400 motion-reduce:transition-none dark:border-white/10", focusRing)}>
        <span className="min-w-0 flex-1"><span className="text-xs text-indigo-700 dark:text-indigo-300">{JOB_WORKSPACES.find((area) => area.id === tool.group)?.label}</span>
          <span className="mt-1 block text-sm font-semibold">{tool.label}</span><span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">{tool.description}</span></span>
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    </li>)}</ul>
  </section>;
}
