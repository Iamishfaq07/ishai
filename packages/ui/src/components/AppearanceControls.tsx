import type { KeyboardEvent } from "react";
import { ACCENTS, MOTION_LEVELS, TEXT_SIZES, type AccentName, type DesignPrefs, type MotionLevel } from "../design/design";
import { useMotion } from "../hooks/useMotion";
import { cx, focusRing } from "./cx";
import { Check } from "../icons";

export interface AppearanceControlsProps {
  prefs: DesignPrefs;
  onChange: (patch: Partial<DesignPrefs>) => void;
}

/** Radio-group keys (WAI-ARIA): the checked option is the group's one tab stop; arrow keys move and choose. */
function radioKeys<T>(values: readonly T[], current: T, choose: (value: T) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (values.indexOf(current) + step + values.length) % values.length;
    choose(values[next] as T);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
}

const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[];
const MOTION_HINTS: Record<MotionLevel, string> = {
  full: "Things slide, spin and celebrate.",
  reduced: "Fades only. Nothing moves across the screen.",
  off: "No animation at all.",
};
const segment = (on: boolean) =>
  cx(
    "rounded-md px-3 py-1 font-medium",
    on ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
    focusRing,
  );

/** Accent colour swatches, text size and the motion level — shared by the web and desktop Settings. */
export function AppearanceControls({ prefs, onChange }: AppearanceControlsProps) {
  const playing = useMotion();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium" id="accent-label">
          Accent colour
        </span>
        <div
          role="radiogroup"
          aria-labelledby="accent-label"
          className="flex gap-2"
          onKeyDown={radioKeys(ACCENT_NAMES, prefs.accent, (accent) => onChange({ accent }))}
        >
          {ACCENT_NAMES.map((name) => {
            const selected = prefs.accent === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                aria-label={ACCENTS[name].label}
                title={ACCENTS[name].label}
                onClick={() => onChange({ accent: name })}
                className={cx(
                  "h-7 w-7 rounded-full ring-offset-2 ring-offset-white transition-transform motion-ok:hover:scale-110 dark:ring-offset-zinc-900",
                  selected ? "scale-110 ring-2 ring-zinc-900 dark:ring-white" : "ring-0",
                  focusRing,
                )}
                style={{ background: `linear-gradient(135deg, rgb(${ACCENTS[name].palette[3]}), rgb(${ACCENTS[name].palette[6]}))` }}
              >
                {selected && <Check className="mx-auto h-3.5 w-3.5 text-white motion-ok:animate-pop" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium" id="text-size-label">
          Text size
        </span>
        <div
          role="radiogroup"
          aria-labelledby="text-size-label"
          className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
          onKeyDown={radioKeys(
            TEXT_SIZES.map((t) => t.value),
            prefs.textSize,
            (textSize) => onChange({ textSize }),
          )}
        >
          {TEXT_SIZES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={prefs.textSize === t.value}
              tabIndex={prefs.textSize === t.value ? 0 : -1}
              onClick={() => onChange({ textSize: t.value })}
              className={cx(segment(prefs.textSize === t.value), t.value === "sm" ? "text-xs" : t.value === "lg" ? "text-base" : "text-sm")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium" id="motion-label">
            Animations
          </span>
          <div
            role="radiogroup"
            aria-labelledby="motion-label"
            aria-describedby="motion-hint"
            className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
            onKeyDown={radioKeys(
              MOTION_LEVELS.map((m) => m.value),
              prefs.motion,
              (motion) => onChange({ motion }),
            )}
          >
            {MOTION_LEVELS.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={prefs.motion === m.value}
                tabIndex={prefs.motion === m.value ? 0 : -1}
                onClick={() => onChange({ motion: m.value })}
                className={cx(segment(prefs.motion === m.value), "text-sm")}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <p id="motion-hint" className="text-xs text-zinc-500 dark:text-zinc-400">
          {MOTION_HINTS[prefs.motion]}
          {prefs.motion === "full" && playing === "reduced" && " Your device asks for less motion, so this plays as Gentle."}
        </p>
      </div>
    </div>
  );
}
