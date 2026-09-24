import { ACCENTS, TEXT_SIZES, type AccentName, type DesignPrefs } from "../design/design";
import { cx, focusRing } from "./cx";

export interface AppearanceControlsProps {
  prefs: DesignPrefs;
  onChange: (patch: Partial<DesignPrefs>) => void;
}

/** Accent colour swatches, text size and the animations switch — shared by the web and desktop Settings. */
export function AppearanceControls({ prefs, onChange }: AppearanceControlsProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium" id="accent-label">
          Accent colour
        </span>
        <div role="radiogroup" aria-labelledby="accent-label" className="flex gap-2">
          {(Object.keys(ACCENTS) as AccentName[]).map((name) => {
            const selected = prefs.accent === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={ACCENTS[name].label}
                title={ACCENTS[name].label}
                onClick={() => onChange({ accent: name })}
                className={cx(
                  "h-7 w-7 rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-zinc-900",
                  selected ? "scale-110 ring-2 ring-zinc-900 dark:ring-white" : "ring-0",
                  focusRing,
                )}
                style={{ background: `linear-gradient(135deg, rgb(${ACCENTS[name].palette[3]}), rgb(${ACCENTS[name].palette[6]}))` }}
              >
                {selected && (
                  <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5 animate-pop text-white" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium" id="text-size-label">
          Text size
        </span>
        <div role="radiogroup" aria-labelledby="text-size-label" className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
          {TEXT_SIZES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={prefs.textSize === t.value}
              onClick={() => onChange({ textSize: t.value })}
              className={cx(
                "rounded-md px-3 py-1 font-medium",
                t.value === "sm" ? "text-xs" : t.value === "lg" ? "text-base" : "text-sm",
                prefs.textSize === t.value
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
                focusRing,
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium">Animations</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Transitions, the live orb and answer effects</span>
        </span>
        <input
          type="checkbox"
          className="peer sr-only"
          checked={prefs.motion}
          onChange={(e) => onChange({ motion: e.target.checked })}
        />
        <span
          aria-hidden="true"
          className={cx(
            "relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500",
            prefs.motion ? "bg-indigo-500" : "bg-zinc-300 dark:bg-zinc-700",
          )}
        >
          <span
            className={cx(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
              prefs.motion ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </span>
      </label>
    </div>
  );
}
