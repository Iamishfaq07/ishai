import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AdminConfig, AdminConfigUpdate } from "@orbit/types";
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
  AppearanceControls,
  useDesign, confirmDialog } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, Toggle } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useTheme, type ThemePref } from "../lib/theme";

export function SettingsPage() {
  const [theme, setTheme] = useTheme();
  const [design, setDesign] = useDesign();
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
        <div className="mt-5">
          <AppearanceControls prefs={design} onChange={setDesign} />
        </div>
      </Card>
      <HotkeysCard />
      <PrivacyCard />
      <AdvancedSettingsCard />
    </div>
  );
}

/** Admin-only. Rotate provider API keys / models without a redeploy. */
function AdvancedSettingsCard() {
  const status = useAsync(() => api.adminStatus().catch(() => ({ is_admin: false })), []);
  if (status.loading || !status.data?.is_admin) return null;
  return <AdvancedConfig />;
}

const PROVIDER_OPTS: Record<"llm" | "stt", Array<{ value: string; label: string }>> = {
  llm: [
    { value: "auto", label: "Auto (DeepSeek if a key is set)" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "mock", label: "Mock (no real answers)" },
  ],
  stt: [
    { value: "auto", label: "Auto (Deepgram if a key is set)" },
    { value: "deepgram", label: "Deepgram" },
    { value: "mock", label: "Mock (no real transcription)" },
  ],
};

function AdvancedConfig() {
  const cfg = useAsync(() => api.getAdminConfig(), []);
  const [form, setForm] = useState<AdminConfig | null>(null);
  const [deepseekKey, setDeepseekKey] = useState("");
  const [deepgramKey, setDeepgramKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (cfg.data) setForm(cfg.data);
  }, [cfg.data]);

  const set = (patch: Partial<AdminConfig>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const update: AdminConfigUpdate = {
      llm_provider: form.llm_provider,
      stt_provider: form.stt_provider,
      deepseek_base_url: form.deepseek_base_url,
      deepseek_model: form.deepseek_model,
      deepseek_reasoning_model: form.deepseek_reasoning_model,
      deepgram_model: form.deepgram_model,
    };
    if (deepseekKey.trim()) update.deepseek_api_key = deepseekKey.trim();
    if (deepgramKey.trim()) update.deepgram_api_key = deepgramKey.trim();
    try {
      const next = await api.updateAdminConfig(update);
      setForm(next);
      setDeepseekKey("");
      setDeepgramKey("");
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async (which: "deepseek_api_key" | "deepgram_api_key") => {
    if (!(await confirmDialog({ title: "Remove this key?", body: "Orbit falls back to the key from the server environment.", confirmLabel: "Remove", danger: true }))) return;
    setError(null);
    try {
      setForm(await api.updateAdminConfig({ [which]: "" }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold">Advanced (admin)</h2>
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
      </div>
      <p className="mb-4 text-sm text-zinc-500">
        Provider keys and models for the whole workspace. Changes apply to new answers immediately.
      </p>
      {cfg.loading || !form ? (
        <Spinner />
      ) : cfg.error ? (
        <ErrorNote onRetry={cfg.reload}>{errorText(cfg.error)}</ErrorNote>
      ) : (
        <form onSubmit={(e) => void save(e)} className="space-y-5">
          {error && <ErrorNote>{error}</ErrorNote>}
          {!form.secrets_editable && (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Set <code>ORBIT_CONFIG_SECRET</code> on the server to store API keys here. Until then, keys come from the
              server environment and can’t be edited in-app.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Answer provider" htmlFor="llm-provider">
              <Select id="llm-provider" value={form.llm_provider} onChange={(e) => set({ llm_provider: e.target.value })}>
                {PROVIDER_OPTS.llm.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Transcription provider" htmlFor="stt-provider">
              <Select id="stt-provider" value={form.stt_provider} onChange={(e) => set({ stt_provider: e.target.value })}>
                {PROVIDER_OPTS.stt.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
          </div>

          <SecretField
            label="DeepSeek API key"
            id="deepseek-key"
            isSet={form.deepseek_api_key_set}
            disabled={!form.secrets_editable}
            value={deepseekKey}
            onChange={setDeepseekKey}
            onClear={() => void clearKey("deepseek_api_key")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="DeepSeek model" htmlFor="deepseek-model">
              <Input id="deepseek-model" value={form.deepseek_model} onChange={(e) => set({ deepseek_model: e.target.value })} />
            </Field>
            <Field label="DeepSeek reasoning model" htmlFor="deepseek-reasoning">
              <Input id="deepseek-reasoning" value={form.deepseek_reasoning_model}
                     onChange={(e) => set({ deepseek_reasoning_model: e.target.value })} />
            </Field>
          </div>
          <Field label="DeepSeek base URL" htmlFor="deepseek-url">
            <Input id="deepseek-url" value={form.deepseek_base_url} onChange={(e) => set({ deepseek_base_url: e.target.value })} />
          </Field>

          <SecretField
            label="Deepgram API key"
            id="deepgram-key"
            isSet={form.deepgram_api_key_set}
            disabled={!form.secrets_editable}
            value={deepgramKey}
            onChange={setDeepgramKey}
            onClear={() => void clearKey("deepgram_api_key")}
          />
          <Field label="Deepgram model" htmlFor="deepgram-model">
            <Input id="deepgram-model" value={form.deepgram_model} onChange={(e) => set({ deepgram_model: e.target.value })} />
          </Field>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save advanced settings"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function SecretField({
  label,
  id,
  isSet,
  disabled,
  value,
  onChange,
  onClear,
}: {
  label: string;
  id: string;
  isSet: boolean;
  disabled: boolean;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={isSet ? "A key is set. Enter a new one to rotate it." : "No key set — enter one to enable this provider."}
    >
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          placeholder={isSet ? "•••••••• (unchanged)" : "Paste API key"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {isSet && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </Field>
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

  const setPrivacy = async (patch: { store_transcripts?: boolean }) => {
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
    if (!(await confirmDialog({ title: "Sign out everywhere?", body: "You’ll be signed out of Orbit on every device, including the desktop app and this browser.", confirmLabel: "Sign out everywhere", danger: true }))) return;
    try {
      await api.logoutAll();
      await logout().catch(() => undefined);
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const deleteAccount = async () => {
    if (!(await confirmDialog({ title: "Delete your account?", body: "This permanently deletes your account, documents and all sessions.", confirmLabel: "Delete account", danger: true, typeToConfirm: "DELETE" }))) return;
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
        <p className="text-xs text-zinc-500">
          Screenshots are sent to the AI model to answer, then discarded — never stored. Raw audio is never stored.
          Transcript content is never sent to analytics.
        </p>
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
