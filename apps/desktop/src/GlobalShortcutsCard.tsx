import { useEffect, useState, type KeyboardEvent } from "react";
import { Card, cx, focusRing } from "@orbit/ui";
import {
  GLOBAL_DEFAULTS,
  GLOBAL_LABELS,
  acceleratorFromEvent,
  formatAccelerator,
  loadShortcuts,
  saveShortcuts,
  shortcutsEnabled,
  unavailableShortcuts,
  type GlobalAction,
} from "./globalShortcuts";

/** Settings: see, rebind (press a new combo), reset or turn off the system-wide shortcuts. */
export function GlobalShortcutsCard() {
  const [map, setMap] = useState(loadShortcuts);
  const [enabled, setEnabled] = useState(shortcutsEnabled);
  const [recording, setRecording] = useState<GlobalAction | null>(null);
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());

  // Registration is async; re-read which combos another app refused us shortly after any change.
  useEffect(() => {
    const t = setTimeout(() => setTaken(new Set(unavailableShortcuts())), 600);
    return () => clearTimeout(t);
  }, [map, enabled]);

  const commit = (next: Record<GlobalAction, string>, on = enabled) => {
    setMap(next);
    setEnabled(on);
    saveShortcuts(next, on);
  };

  const onKeyDown = (action: GlobalAction) => (e: KeyboardEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (e.key === "Escape") return setRecording(null);
    const acc = acceleratorFromEvent(e.nativeEvent);
    if (!acc) return;
    setRecording(null);
    commit({ ...map, [action]: acc });
  };

  const counts = Object.values(map).reduce<Record<string, number>>((c, a) => ({ ...c, [a]: (c[a] ?? 0) + 1 }), {});

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Global shortcuts</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Work even while Zoom, Teams or your browser is focused.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => commit(map, e.target.checked)} className="accent-indigo-500" />
          On
        </label>
      </div>
      <ul className={cx("divide-y divide-zinc-100 dark:divide-zinc-800", !enabled && "opacity-50")}>
        {(Object.keys(GLOBAL_LABELS) as GlobalAction[]).map((action) => {
          const acc = map[action];
          const problem = counts[acc]! > 1 ? "Used twice" : enabled && taken.has(acc) ? "Taken by another app" : null;
          return (
            <li key={action} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">{GLOBAL_LABELS[action]}</span>
              <span className="flex items-center gap-2">
                {problem && <span className="text-xs text-amber-600 dark:text-amber-400">{problem}</span>}
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => setRecording(action)}
                  onKeyDown={recording === action ? onKeyDown(action) : undefined}
                  onBlur={() => recording === action && setRecording(null)}
                  className={cx(
                    "min-w-[9rem] rounded-lg border px-2.5 py-1 font-mono text-xs",
                    recording === action
                      ? "animate-glow border-indigo-500 text-indigo-600 dark:text-indigo-300"
                      : "border-zinc-200 text-zinc-700 hover:border-indigo-400 dark:border-zinc-700 dark:text-zinc-200",
                    focusRing,
                  )}
                  title="Click, then press the new combination (Esc to cancel)"
                >
                  {recording === action ? "Press keys…" : formatAccelerator(acc)}
                </button>
                {acc !== GLOBAL_DEFAULTS[action] && (
                  <button
                    type="button"
                    onClick={() => commit({ ...map, [action]: GLOBAL_DEFAULTS[action] })}
                    className={cx("text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200", focusRing)}
                  >
                    Reset
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
