import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CreditCard,
  House,
  LogOut,
  MOCK_INTERVIEW_ENABLED,
  MessageCircle,
  MoonStar,
  Search,
  Send,
  SettingsIcon,
  cx,
  focusRing,
  useFocusTrap,
  type LucideIcon,
  safeLocal,
} from "@orbit/ui";
import { api } from "../lib/api";
import { applyTheme, type ThemePref } from "../lib/theme";
import { useAsync } from "../lib/useAsync";
import { baseCommands, recentCommands, searchCommands, type Command, type CommandGroup } from "../lib/palette";
import { PRODUCTS, ProductMark } from "./products";

/**
 * Search everything (Ctrl+K or "/" anywhere in the app, or the search button): pages, actions, and your recent
 * resumes, sessions and tracked jobs. A combobox over a listbox: type to filter, arrows to move, Enter to open,
 * Escape to close. Its own chunk, loaded the first time it opens; the matching is lib/palette.ts.
 */

const RUN_ICON: Record<NonNullable<Command["run"]>, LucideIcon> = { help: MessageCircle, theme: MoonStar, "sign-out": LogOut };
const GROUPS: CommandGroup[] = ["Recent", "Actions", "Go to"];

function CommandIcon({ command }: { command: Command }) {
  if (command.product) return <ProductMark product={command.product} size="sm" />;
  const Icon = command.run
    ? RUN_ICON[command.run]
    : command.to === "/billing"
      ? CreditCard
      : command.to === "/settings"
        ? SettingsIcon
        : command.to === "/contact"
          ? Send
          : House;
  return (
    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/15 dark:text-zinc-300">
      <Icon className="h-4 w-4" />
    </span>
  );
}

function toggleTheme(): void {
  const next: ThemePref = document.documentElement.classList.contains("dark") ? "light" : "dark";
  try {
    safeLocal.setItem("orbit.theme", next);
  } catch {
    // storage blocked: the switch lasts for this visit
  }
  applyTheme(next);
}

export default function CommandPalette({ onClose, onHelp, onSignOut }: { onClose: () => void; onHelp: () => void; onSignOut: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose, initialFocus: () => inputRef.current });

  // The same cache keys as the pages, so what they loaded shows at once.
  const resumes = useAsync(() => api.listResumes(), [], "resumes");
  const sessions = useAsync(() => api.listSessions(), [], "sessions");
  const tracker = useAsync(() => api.jobTracker(), [], "job-tracker");

  const all = useMemo(
    () => [
      ...recentCommands({ resumes: resumes.data, sessions: sessions.data, tracker: tracker.data }),
      ...baseCommands({ mockEnabled: MOCK_INTERVIEW_ENABLED }),
    ],
    [resumes.data, sessions.data, tracker.data],
  );
  // With nothing typed: the actions and pages by group, plus the three newest things (the rest are a search away).
  // With a query: one list, best match first, whatever its group.
  const sections = useMemo((): Array<{ label: string; items: Command[] }> => {
    if (query.trim()) return [{ label: "Best matches", items: searchCommands(query, all, 30) }];
    const recent = all.filter((c) => c.group === "Recent").slice(0, 3);
    const rest = searchCommands("", all.filter((c) => c.group !== "Recent"), 30);
    return GROUPS.map((g) => ({ label: g, items: g === "Recent" ? recent : rest.filter((c) => c.group === g) })).filter((x) => x.items.length);
  }, [all, query]);
  const results = useMemo(() => sections.flatMap((x) => x.items), [sections]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    if (command.run === "help") onHelp();
    else if (command.run === "theme") toggleTheme();
    else if (command.run === "sign-out") onSignOut();
    else if (command.to) navigate(command.to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  };

  const optionId = (i: number) => `palette-option-${i}`;
  let index = -1;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-black/45 p-3 pt-[8vh] sm:pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search Orbit"
        className="flex max-h-[min(36rem,80vh)] w-full max-w-xl animate-scale-in flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-950"
      >
        <div className="flex items-center gap-3 border-b border-zinc-200/80 px-4 dark:border-white/10">
          <Search className="h-5 w-5 shrink-0 text-zinc-500" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(active) : undefined}
            aria-label="Search pages, actions, resumes and jobs"
            placeholder="Search pages, actions, resumes, jobs…"
            autoComplete="off"
            spellCheck={false}
            // 16 px, so phones don't zoom in on focus.
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100 dark:placeholder:text-zinc-400"
          />
          <button
            type="button"
            onClick={onClose}
            className={cx("rounded-md border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-600 dark:border-white/15 dark:text-zinc-300", focusRing)}
          >
            Esc
          </button>
        </div>
        <ul ref={listRef} id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {sections.map(({ label, items }, g) => {
            return (
              <li key={label} role="presentation">
                <ul role="group" aria-labelledby={`palette-group-${g}`}>
                  <li role="presentation" id={`palette-group-${g}`} className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {label}
                  </li>
                  {items.map((command) => {
                    index += 1;
                    const i = index;
                    const selected = i === active;
                    return (
                      <li
                        key={command.id}
                        id={optionId(i)}
                        data-index={i}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => !selected && setActive(i)}
                        onClick={() => choose(command)}
                        className={cx(
                          "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm",
                          selected ? "bg-indigo-500/10 text-zinc-900 dark:bg-white/[0.07] dark:text-white" : "text-zinc-700 dark:text-zinc-200",
                        )}
                      >
                        <CommandIcon command={command} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{command.title}</span>
                          {(command.hint || command.product) && (
                            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {command.hint ?? PRODUCTS[command.product as keyof typeof PRODUCTS].name}
                            </span>
                          )}
                        </span>
                        {selected && <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          {results.length === 0 && (
            <li role="presentation" className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Nothing matches “{query.trim()}”. Try “resume”, “jobs” or “credits”.
            </li>
          )}
        </ul>
        <p className="hidden border-t border-zinc-200/80 px-4 py-2 text-xs text-zinc-500 sm:block dark:border-white/10 dark:text-zinc-400" aria-hidden="true">
          ↑ ↓ to move · Enter to open · Esc to close
        </p>
      </div>
    </div>
  );
}
