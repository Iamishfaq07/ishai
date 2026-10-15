import { Button, Card, ShieldCheck } from "@orbit/ui";
import { useWindowPrivacy } from "./windowPrivacy";

const SHIELD_HELP =
  "Keeps Orbit's window out of screenshots, screen recordings and Windows Recall on this computer (Windows display affinity). " +
  "Some capture tools don't honour it, and it doesn't hide Orbit from Task Manager, other programs or anyone who can see your screen.";

/** Settings → Window privacy: two separate switches, both off until chosen. */
export function WindowPrivacyCard() {
  const [prefs, update] = useWindowPrivacy();
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Window privacy</h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">Your choice, on this computer. Changes apply straight away.</p>
      <div className="space-y-4">
        <label className="flex cursor-pointer items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Privacy shield</span>
            <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{SHIELD_HELP}</span>
          </span>
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-indigo-500" checked={prefs.shield} onChange={(e) => update({ shield: e.target.checked })} />
        </label>
        <label className="flex cursor-pointer items-start justify-between gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <span>
            <span className="block text-sm font-medium">Hide from the taskbar</span>
            <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">Orbit stays in the system tray instead. Off: it shows in the taskbar like any app.</span>
          </span>
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-indigo-500" checked={prefs.hideFromTaskbar} onChange={(e) => update({ hideFromTaskbar: e.target.checked })} />
        </label>
      </div>
    </Card>
  );
}

/** Home, once: the shield choice in plain words, nothing preselected. Gone after either answer (Settings changes it). */
export function WindowPrivacyChoice() {
  const [prefs, update] = useWindowPrivacy();
  if (prefs.chosen) return null;
  return (
    <section aria-labelledby="privacy-choice" className="rounded-2xl border border-indigo-500/25 bg-indigo-500/5 p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="privacy-choice" className="text-sm font-semibold">Keep Orbit's window out of screenshots and recordings?</h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{SHIELD_HELP} You can change this any time in Settings.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => update({ shield: true })}>Turn on the privacy shield</Button>
            <Button size="sm" variant="secondary" onClick={() => update({ shield: false })}>Leave it off</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
