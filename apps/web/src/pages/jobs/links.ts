import { cx, focusRing } from "@orbit/ui";

/**
 * A router link that looks like a Button (packages/ui): Jobs AI's "go somewhere" actions are links, so they open in
 * a new tab and read as links to screen readers.
 */
export function linkButton(variant: "primary" | "secondary" | "ghost" = "primary", size: "sm" | "md" | "lg" = "md"): string {
  return cx(
    "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-colors duration-150",
    size === "sm" && "px-2.5 py-1.5 text-xs",
    size === "md" && "px-4 py-2 text-sm",
    size === "lg" && "px-6 py-3 text-base",
    variant === "primary" &&
      "btn-sheen bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-glow-sm hover:from-indigo-400 hover:to-indigo-500 hover:shadow-glow",
    variant === "secondary" &&
      "border border-zinc-200 bg-white/90 text-zinc-900 hover:border-zinc-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:border-white/20 dark:hover:bg-white/10",
    variant === "ghost" && "text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/5",
    focusRing,
  );
}

/** An inline text link in the accent colour. */
export const textLink = cx("font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing);
