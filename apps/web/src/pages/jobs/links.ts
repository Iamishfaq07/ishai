import { buttonClass, cx, focusRing } from "@orbit/ui";

/**
 * A router link that looks like a Button (packages/ui): Jobs AI's "go somewhere" actions are links, so they open in
 * a new tab and read as links to screen readers. The look is `buttonClass`, so it can't drift from a real button.
 */
export function linkButton(variant: "primary" | "secondary" | "ghost" = "primary", size: "sm" | "md" | "lg" = "md"): string {
  return buttonClass(variant, size);
}

/** An inline text link in the accent colour. */
export const textLink = cx("font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing);
