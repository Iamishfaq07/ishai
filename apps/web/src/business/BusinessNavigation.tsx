import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import type { BizCompany } from "@orbit/types";
import { BookOpen, Briefcase, Building2, ChevronDown, CreditCard, Gauge, Search, SettingsIcon, ShieldCheck, Users, buttonClass, cx, focusRing } from "@orbit/ui";
import { ROLE_LABEL, companyPath } from "./model";
import { BUSINESS_NAV_GROUPS, businessNavItems, currentBusinessWorkspace } from "./navigation";

const ICONS = { Overview: Gauge, Hiring: Briefcase, Coordination: ShieldCheck, Relationships: Users, Knowledge: BookOpen, Company: SettingsIcon };

export function BusinessNavigation({ company, sidebar = false }: { company: BizCompany; sidebar?: boolean }) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const allItems = businessNavItems(company);
  const items = businessNavItems(company, query);
  const active = currentBusinessWorkspace(pathname.slice(companyPath(company.id).length).replace(/^\//, ""), allItems);
  useEffect(() => { if (disclosure.current) disclosure.current.open = false; }, [pathname]);
  const links = <>
    <label htmlFor={searchId} className="sr-only">Find a workspace</label>
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-500" aria-hidden="true" /><input id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a workspace" className={cx("min-h-11 w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-white/15 dark:bg-zinc-900", focusRing)} /></div>
    <div className="mt-5 space-y-5">{BUSINESS_NAV_GROUPS.map(group => {
      const children = items.filter(item => item.group === group);
      if (!children.length) return null;
      return <div key={group}><p className="mb-1.5 px-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{group}</p><ul className="space-y-1">{children.map(item => {
        const Icon = item.to === "plan" ? CreditCard : item.to === "launchpad" ? Building2 : ICONS[group];
        return <li key={item.to}><NavLink to={companyPath(company.id, item.to)} end={!item.to} onClick={() => {
          setQuery("");
          if (disclosure.current?.open) { disclosure.current.open = false; requestAnimationFrame(() => document.getElementById("main")?.focus()); }
        }} className={({ isActive }) => cx("group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-quick", isActive ? "bg-indigo-50 font-semibold text-indigo-800 dark:bg-indigo-400/10 dark:text-indigo-200" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white", focusRing)}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0">{item.label}</span></NavLink></li>;
      })}</ul></div>;
    })}</div>
    {!items.length && <div className="py-5 text-sm text-zinc-600 dark:text-zinc-400"><p role="status">No matching workspaces for your role.</p><button className={buttonClass("ghost", "sm", "mt-2")} onClick={() => setQuery("")}>Clear workspace search</button></div>}
  </>;
  if (sidebar) return <aside className="sticky top-14 hidden max-h-[calc(100dvh-3.5rem)] w-60 shrink-0 self-start overflow-y-auto border-r border-zinc-200 bg-zinc-50/50 p-4 dark:border-white/10 dark:bg-white/[0.02] lg:block">
    <div className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"><p className="text-xs text-zinc-500 dark:text-zinc-400">Company workspace</p><p className="mt-2 break-words font-semibold">{company.name}</p><p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{ROLE_LABEL[company.role]} · {company.verified ? "Verified domain" : "Verification pending"}</p></div>
    <nav aria-label={`${company.name} workspaces`}>{links}</nav>
    <div className="mt-6 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-white/20"><p className="text-sm font-medium">Plan your next rollout</p><p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">Discover the tools and build a checklist for your team.</p><Link to={companyPath(company.id, "launchpad")} className={cx("mt-2 inline-flex min-h-11 items-center rounded text-xs font-medium text-indigo-700 dark:text-indigo-300", focusRing)}>Explore the launchpad →</Link></div>
  </aside>;
  return <div className="border-b border-zinc-200 dark:border-white/10 lg:hidden"><details ref={disclosure} className="group mx-auto max-w-7xl px-4 sm:px-6" onKeyDown={e => { if (e.key === "Escape" && disclosure.current?.open) { e.preventDefault(); disclosure.current.open = false; summary.current?.focus(); } }}>
    <summary ref={summary} className={cx("flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 [&::-webkit-details-marker]:hidden", focusRing)}><span><span className="block text-xs text-zinc-500 dark:text-zinc-400">Browse workspaces</span><span className="text-sm font-semibold">{active?.label ?? "Company workspace"}</span></span><ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-quick motion-ok:group-open:rotate-180" aria-hidden="true" /></summary>
    <nav aria-label={`${company.name} workspaces`} className="max-h-[65dvh] overflow-y-auto pb-5 pt-2">{links}</nav>
  </details></div>;
}
