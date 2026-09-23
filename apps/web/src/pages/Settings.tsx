import { useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_LABELS,
  comboFromEvent,
  cx,
  focusRing,
  formatHotkey,
  loadHotkeys,
  saveHotkeys,
  type HotkeyAction,
  type HotkeyMap,
} from "@orbit/ui";
import { Button, Card, ErrorNote, PageHeader, Select, Toggle } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText } from "../lib/format";
import { useTheme, type ThemePref } from "../lib/theme";

export function SettingsPage() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" />
      <Card>
        <h2 className="mb-4 font-semibold">Appearance</h2>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="theme" className="text-sm font-medium">
            Theme
          </label>
          <div className="w-40">
            <Select id="theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </Select>
          </div>
        </div>
      </Card>
      <HotkeysCard />
      <PrivacyCard />
    </div>
  );
}

function HotkeysCard() {
  const [map, setMap] = useState<HotkeyMap>(loadHotkeys);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);

  const update = (next: HotkeyMap) => {
    setMap(next);
    saveHotkeys(next);
  };

  const onKeyDown = (action: HotkeyAction) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (recording !== action) return;
    e.preventDefault();
    if (e.key === "Escape") {
      setRecording(null);
      return;
    }
    const combo = comboFromEvent(e.nativeEvent);
    if (!combo) return;
    update({ ...map, [action]: combo });
    setRecording(null);
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Keyboard shortcuts</h2>
        <Button variant="ghost" size="sm" onClick={() => update(DEFAULT_HOTKEYS)}>
          Reset to defaults
        </Button>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {(Object.keys(HOTKEY_LABELS) as HotkeyAction[]).map((action) => (
          <li key={action} className="flex items-center justify-between py-2.5 text-sm">
            <span>{HOTKEY_LABELS[action]}</span>
            <button
              type="button"
              onClick={() => setRecording(recording === action ? null : action)}
              onKeyDown={onKeyDown(action)}
              onBlur={() => recording === action && setRecording(null)}
              aria-label={`Change shortcut for ${HOTKEY_LABELS[action]}`}
              className={cx(
                "min-w-[8rem] rounded-lg border px-3 py-1.5 font-mono text-xs",
                recording === action
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                  : "border-zinc-200 dark:border-zinc-800",
                focusRing,
              )}
            >
              {recording === action ? "Press keys…" : formatHotkey(map[action])}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-zinc-500">Shortcuts need a modifier (Ctrl/⌘, Shift or Alt) so typing never triggers them.</p>
    </Card>
  );
}

function PrivacyCard() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const setPrivacy = async (patch: { store_transcripts?: boolean; store_screenshots?: boolean }) => {
    setSaving(true);
    setError(null);
    try {
      setUser(await api.updatePrivacy(patch));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const signOutEverywhere = async () => {
    if (!window.confirm("Sign out of Orbit on every device, including the desktop app and this browser?")) return;
    try {
      await api.logoutAll();
      await logout().catch(() => undefined);
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const deleteAccount = async () => {
    const typed = window.prompt('This permanently deletes your account, documents, and all sessions. Type "DELETE" to confirm.');
    if (typed !== "DELETE") return;
    try {
      await api.deleteAccount();
      await logout().catch(() => undefined);
      navigate("/register", { replace: true });
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card>
      <h2 className="mb-4 font-semibold">Privacy</h2>
      <div className="space-y-4">
        <Toggle
          checked={user.store_transcripts}
          disabled={saving}
          onChange={(v) => void setPrivacy({ store_transcripts: v })}
          label="Store transcripts"
          description="Keep session transcripts in History. Off: transcripts are used live and discarded when the session ends."
        />
        <Toggle
          checked={user.store_screenshots}
          disabled={saving}
          onChange={(v) => void setPrivacy({ store_screenshots: v })}
          label="Store screenshots"
          description="Keep captured screenshots with the session. Off: images are analyzed and discarded."
        />
        <p className="text-xs text-zinc-500">Raw audio is never stored. Transcript content is never sent to analytics.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Button variant="secondary" onClick={() => void signOutEverywhere()}>
            Sign out of all devices
          </Button>
          <Button variant="danger" onClick={() => void deleteAccount()}>
            Delete account
          </Button>
        </div>
      </div>
    </Card>
  );
}
