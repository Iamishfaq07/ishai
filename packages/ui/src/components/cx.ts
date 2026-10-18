/** Tiny className joiner (avoids a clsx dependency). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * The keyboard focus mark: a 2 px accent outline 2 px outside the control, following its corners. An outline's gap is
 * see-through, so it reads the same on any surface (a card, the canvas, a dark panel, a coloured button) in either
 * theme, where a ring's offset had to be painted in one surface colour (a dark halo on the dark canvas). Keyboard
 * only (:focus-visible): a click or a tap never draws it.
 */
export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:focus-visible:outline-indigo-400";
