import { useEffect, useState } from "react";
import { cx, focusRing } from "@orbit/ui";

export interface PageSection {
  id: string;
  label: string;
}

/**
 * A long page's sections as links, the one you're reading marked (Settings, the Jobs AI profile). The page stays one
 * scroll, so find-in-page keeps working. Each section needs the `id` and a `scroll-mt-*` so a jump clears the header.
 */
export function OnThisPage({ sections, label, className }: { sections: PageSection[]; label: string; className?: string }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setActive(seen.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const { id } of sections) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sections]);
  return (
    <nav aria-label={label} className={className}>
      <p className="mb-2 px-3 text-xs font-medium text-zinc-500">On this page</p>
      <ul className="space-y-0.5 border-l border-zinc-200 dark:border-white/10">
        {sections.map(({ id, label: text }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={active === id ? "location" : undefined}
              className={cx(
                "-ml-px block border-l-2 px-3 py-1.5 text-sm transition-colors",
                active === id
                  ? "border-indigo-500 font-medium text-zinc-900 dark:border-indigo-400 dark:text-white"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:hover:border-white/20 dark:hover:text-zinc-200",
                focusRing,
              )}
            >
              {text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
