import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx, focusRing } from "./cx";

/** Plain-word meanings for the jargon a first-time user meets. Short sentences; no other jargon inside. */
export const GLOSSARY = {
  ats: "Applicant tracking system: the software most companies use to read and sort resumes before a person sees them.",
  jd: "Job description: the job post itself, with the role, the skills and the experience the company asks for.",
  utr: "Unique transaction reference: the 12-digit number your UPI app shows for every payment. It's how your payment is found.",
  star: "Situation, Task, Action, Result: an easy order for telling a story in an interview answer.",
  "fit-check": "A free AI reading of one job against your resume: what fits, what's missing and whether it's worth applying.",
  tailor: "Making a copy of your resume reworded for one job post, using only what's true about you.",
} as const;
export type GlossaryTerm = keyof typeof GLOSSARY;

/**
 * A word with a dotted underline that explains itself: hover it, tap it or press Enter on it for a short meaning.
 * Screen readers hear the meaning with the word, so nobody has to open it. Use `term` for the glossary or `tip` for
 * anything else. Escape, a tap outside or tabbing away closes it.
 *
 *   We check it the way an <Term term="ats">ATS</Term> reads it.
 */
export function Term({ children, term, tip }: { children: ReactNode; term?: GlossaryTerm; tip?: ReactNode }) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const open = pinned || hovered;
  const meaning = tip ?? (term ? GLOSSARY[term] : null);

  // Keep the bubble on screen: centred under the word, nudged in from either edge of a phone.
  useLayoutEffect(() => {
    if (!open || !bubble.current) return setShift(0);
    const r = bubble.current.getBoundingClientRect();
    const room = document.documentElement.clientWidth - 8;
    setShift(r.left < 8 ? 8 - r.left : r.right > room ? room - r.right : 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setPinned(false);
      setHovered(false);
    };
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(leaving.current), []);

  if (!meaning) return <>{children}</>;
  return (
    <span
      ref={wrap}
      className="relative inline"
      // Mouse only: a tap is a click, and a touch "hover" would open and close it in one go.
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(leaving.current);
        setHovered(true);
      }}
      // A short grace period to cross the gap into the bubble (WCAG 1.4.13: its content can be hovered).
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") leaving.current = setTimeout(() => setHovered(false), 150);
      }}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPinned(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => setPinned((p) => !p)}
        className={cx(
          "cursor-help rounded-sm underline decoration-zinc-400 decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-current dark:decoration-zinc-500",
          focusRing,
        )}
      >
        {children}
      </button>
      <span
        ref={bubble}
        id={id}
        role="tooltip"
        style={shift ? { marginLeft: shift } : undefined}
        // Still in the page when closed (display: none), so aria-describedby keeps reading it.
        className={cx(
          open ? "block" : "hidden",
          "absolute left-1/2 top-full z-40 mt-1.5 w-max max-w-[min(18rem,calc(100vw-1rem))] -translate-x-1/2 rounded-lg bg-zinc-900 px-3 py-2 text-left font-sans text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-popover animate-fade-in dark:bg-zinc-100 dark:text-zinc-900",
        )}
      >
        {meaning}
      </span>
    </span>
  );
}
