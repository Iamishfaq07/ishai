import { Link } from "react-router-dom";
import { DialogActions, HOTKEY_LABELS, Sheet, buttonClass, formatHotkey, isMacPlatform, loadHotkeys, type HotkeyAction } from "@orbit/ui";

/** One key, drawn as a key. */
function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs text-zinc-800 dark:border-white/15 dark:bg-white/5 dark:text-zinc-100">
      {children}
    </kbd>
  );
}

function Row({ label, keys }: { label: string; keys: string[][] }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2 text-sm">
      <span>{label}</span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {keys.map((combo, i) => (
          <span key={combo.join("+")} className="flex items-center gap-1">
            {i > 0 && <span className="text-xs text-zinc-500">or</span>}
            {combo.map((k) => (
              <Key key={k}>{k}</Key>
            ))}
          </span>
        ))}
      </span>
    </li>
  );
}

/**
 * "?" anywhere outside a text field: the keyboard shortcuts, in one sheet. The workbench's own (search), the resume
 * editor's undo, and the live session's, as this device has them set (Settings → Keyboard shortcuts changes those).
 */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const mod = isMacPlatform() ? "⌘" : "Ctrl";
  const live = loadHotkeys();
  return (
    <Sheet
      open
      onClose={onClose}
      title="Keyboard shortcuts"
      size="md"
      footer={
        <DialogActions>
          <Link to="/settings#shortcuts" onClick={onClose} className={buttonClass("ghost")}>
            Change the live ones
          </Link>
          <button type="button" onClick={onClose} className={buttonClass("primary")}>
            Done
          </button>
        </DialogActions>
      }
    >
      <div className="px-5 py-4">
      <section aria-labelledby="keys-anywhere">
        <h3 id="keys-anywhere" className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          Anywhere
        </h3>
        <ul className="divide-y divide-zinc-100 dark:divide-white/10">
          <Row label="Search and go to a page" keys={[[mod, "K"], ["/"]]} />
          <Row label="These shortcuts" keys={[["?"]]} />
          <Row label="Close a dialog or menu" keys={[["Esc"]]} />
        </ul>
      </section>
      <section aria-labelledby="keys-resume" className="mt-5">
        <h3 id="keys-resume" className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          Resume editor
        </h3>
        <ul className="divide-y divide-zinc-100 dark:divide-white/10">
          <Row label="Undo (outside a text field)" keys={[[mod, "Z"]]} />
          <Row label="Redo" keys={[[mod, "Shift", "Z"], [mod, "Y"]]} />
        </ul>
      </section>
      <section aria-labelledby="keys-live" className="mt-5">
        <h3 id="keys-live" className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          In a live session
        </h3>
        <ul className="divide-y divide-zinc-100 dark:divide-white/10">
          {(Object.keys(HOTKEY_LABELS) as HotkeyAction[]).map((action) => (
            <Row key={action} label={HOTKEY_LABELS[action]} keys={[formatHotkey(live[action]).split(/[+ ]/).filter(Boolean)]} />
          ))}
        </ul>
      </section>
      </div>
    </Sheet>
  );
}
