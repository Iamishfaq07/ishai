import { useEffect, useRef, useState } from "react";
import { Contrast, cx, floatingClass, focusRing } from "@orbit/ui";
import { GLASS_MIN, useGlass } from "./glass";

/** Transparency slider + blur toggle (Settings → Appearance, and the live window's quick popover). */
export function GlassControls({ compact = false }: { compact?: boolean }) {
  const [glass, setGlass] = useGlass();
  const pct = Math.round(glass.opacity * 100);
  return (
    <div className={cx(compact ? "space-y-2" : "space-y-4")}>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label htmlFor="glass-opacity" className="text-sm font-medium">
            Window transparency
          </label>
          <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {pct === 100 ? "Solid" : `${100 - pct}% see-through`}
          </span>
        </div>
        <input
          id="glass-opacity"
          type="range"
          min={GLASS_MIN * 100}
          max={100}
          step={5}
          value={pct}
          onChange={(e) => setGlass({ opacity: Number(e.target.value) / 100 })}
          className="w-full accent-indigo-500"
          aria-valuetext={`${pct}% opaque background`}
        />
        {!compact && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Only the background fades — text always stays fully visible.
          </p>
        )}
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-sm font-medium">Blur what's behind</span>
        <input
          type="checkbox"
          checked={glass.blur}
          onChange={(e) => setGlass({ blur: e.target.checked })}
          className="h-4 w-4 accent-indigo-500"
        />
      </label>
    </div>
  );
}

/** Title-bar button that opens GlassControls in a small popover (live window). */
export function GlassButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Transparency"
        aria-label="Transparency"
        className={cx(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-800 active:bg-zinc-900/10 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100",
          focusRing,
        )}
      >
        <Contrast className="h-4 w-4" />
      </button>
      {open && (
        <div className={cx(floatingClass("popover"), "glass-solid absolute right-0 top-full z-popover mt-1.5 w-64 origin-top-right animate-menu-in p-3.5")}>
          <GlassControls compact />
        </div>
      )}
    </span>
  );
}
