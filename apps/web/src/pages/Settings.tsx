import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AdminConfig, AdminConfigUpdate, SignedInDevice } from "@orbit/types";
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
  useDesign,
  confirmDialog,
  LoadGate,
  SettingsIcon,
  CreditCard,
  ChevronRight,
  Inbox,
  IndianRupee,
  Spot,
  Users,
  CostDashboard,
  type SpotKind,
  toast,
  useFlash,
} from "@orbit/ui";
import { CountryField } from "../components/CountryField";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Toggle } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { useTheme, type ThemePref } from "../lib/theme";
import { OnThisPage, type PageSection } from "../components/OnThisPage";
import { InterviewerVoiceCard } from "./InterviewerVoiceCard";
import { PasskeysCard } from "./PasskeysCard";
import { TwoFactorCard } from "./TwoFactorCard";

export function SettingsPage() {
  const [theme, setTheme] = useTheme();
  const [design, setDesign] = useDesign();
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,48rem)_11rem] lg:gap-10">
      <div className="max-w-3xl space-y-6">
        <PageHeader icon={SettingsIcon} title="Settings" />
        <Link
          to="/billing"
          className={cx(
            "glass-panel lift flex items-center gap-4 rounded-2xl p-5 hover:border-indigo-400/40",
            focusRing,
          )}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
            <CreditCard className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block font-display font-semibold">Plan &amp; usage</span>
            <span className="block text-sm text-zinc-500">Your plan, this month’s minutes, screenshots and documents.</span>
          </span>
          <ChevronRight className="h-4 w-4 text-zinc-400" />
        </Link>
        <Card id="appearance" className="scroll-mt-24">
          <SectionTitle spot="appearance" className="mb-4">
            Appearance
          </SectionTitle>
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
        <InterviewerVoiceCard />
        <AccountCard />
        <TwoFactorCard />
        <PasskeysCard />
        <DevicesCard />
        <PrivacyCard />
        <AdvancedSettingsCard />
      </div>
      <SectionNav />
    </div>
  );
}

/** A settings card's heading: its icon in a small accent chip, then the name. */
function SectionTitle({ spot, className, children }: { spot: SpotKind; className?: string; children: string }) {
  return (
    <h2 className={cx("flex items-center gap-3 font-semibold", className)}>
      <Spot kind={spot} />
      {children}
    </h2>
  );
}

const SECTIONS: PageSection[] = [
  { id: "appearance", label: "Appearance" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
  { id: "interviewer-voice", label: "Interviewer voice" },
  { id: "account", label: "Account" },
  { id: "two-step", label: "Two-step sign-in" },
  { id: "passkeys", label: "Passkeys" },
  { id: "devices", label: "Devices" },
  { id: "privacy", label: "Privacy" },
];

/** Wide screens only: the sections as links in the empty column beside the cards. */
function SectionNav() {
  return (
    <div className="hidden lg:block">
      <OnThisPage sections={SECTIONS} label="Settings sections" className="sticky top-24 pt-[4.75rem]" />
    </div>
  );
}

/** Admin-only. Rotate provider API keys / models without a redeploy. */
function AdvancedSettingsCard() {
  const status = useAsync(() => api.adminStatus().catch(() => ({ is_admin: false })), []);
  if (status.loading || !status.data?.is_admin) return null;
  return (
    <>
      <Link to="/admin/users" className={cx("glass-panel lift flex items-center gap-4 rounded-2xl p-5 hover:border-indigo-400/40", focusRing)}>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
          <Users className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block font-display font-semibold">Users &amp; access</span>
          <span className="block text-sm text-zinc-500">Who signed up, who's waiting, and giving them access for a while or for good.</span>
        </span>
        <ChevronRight className="h-4 w-4 text-zinc-400" />
      </Link>
      <Link to="/admin/inbox" className={cx("glass-panel lift flex items-center gap-4 rounded-2xl p-5 hover:border-indigo-400/40", focusRing)}>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
          <Inbox className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block font-display font-semibold">Inbox</span>
          <span className="block text-sm text-zinc-500">Messages from the Contact page: read, reply and mark them done.</span>
        </span>
        <ChevronRight className="h-4 w-4 text-zinc-400" />
      </Link>
      <Link to="/admin/payments" className={cx("glass-panel lift flex items-center gap-4 rounded-2xl p-5 hover:border-indigo-400/40", focusRing)}>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
          <IndianRupee className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block font-display font-semibold">Payments</span>
          <span className="block text-sm text-zinc-500">UPI payments to check against your bank, and approve so the plan turns on.</span>
        </span>
        <ChevronRight className="h-4 w-4 text-zinc-400" />
      </Link>
      <AdvancedConfig />
      <Card>
        <CostDashboard load={api.getCosts} />
      </Card>
    </>
  );
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
  const [justSaved, flashSaved] = useFlash();

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
      flashSaved();
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
        <SectionTitle spot="admin">Advanced (admin)</SectionTitle>
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
      </div>
      <p className="mb-4 text-sm text-zinc-500">
        Provider keys and models for the whole workspace. Changes apply to new answers immediately.
      </p>
      {/* The error first: a failed load leaves no form, and checking `!form` first would spin for ever. */}
      {cfg.error ? (
        <ErrorNote onRetry={cfg.reload}>{errorText(cfg.error)}</ErrorNote>
      ) : (
        <LoadGate loading={cfg.loading || !form} variant="line" count={6} label="Loading settings">
        {form && (
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
            <Button type="submit" loading={saving} loadingText="Saving…" done={justSaved}>
              Save advanced settings
            </Button>
          </div>
        </form>
        )}
        </LoadGate>
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
    <Card id="shortcuts" className="scroll-mt-24">
      <div className="mb-4 flex items-center justify-between">
        <SectionTitle spot="keyboard">Keyboard shortcuts</SectionTitle>
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
              // What it shows first (the keys, or "Press keys…"), then what it changes (WCAG 2.5.3).
              aria-label={`${recording === action ? "Press keys…" : formatHotkey(map[action])}: change the shortcut for ${HOTKEY_LABELS[action]}`}
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

/** Change the sign-in email (confirmed from the new inbox) and download everything Orbit stores. */
function AccountCard() {
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const change = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestEmailChange(newEmail.trim(), password);
      setSent(newEmail.trim());
      setPassword("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orbit-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card id="account" className="scroll-mt-24">
      <SectionTitle spot="account" className="mb-1">
        Account
      </SectionTitle>
      <p className="mb-4 pl-[2.375rem] text-sm text-zinc-500">Signed in as {user.email}</p>
      <div className="mb-5 max-w-sm">
        <CountryField id="settings-country" />
      </div>
      {sent ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Check <strong>{sent}</strong> for a confirmation link. Your email changes when you open it; until then you
          keep signing in with {user.email}.
        </p>
      ) : user.has_password === false ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Set a password below before changing the email on this account.</p>
      ) : (
        <form onSubmit={(e) => void change(e)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="New email" htmlFor="new-email">
            <Input id="new-email" type="email" autoComplete="email" required value={newEmail}
                   onChange={(e) => setNewEmail(e.target.value)} />
          </Field>
          <Field label="Current password" htmlFor="confirm-password">
            <Input id="confirm-password" type="password" autoComplete="current-password" required value={password}
                   onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" loading={busy} loadingText="Sending…" disabled={!newEmail || !password}>
            Change email
          </Button>
        </form>
      )}
      <PasswordChange />
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <Button variant="secondary" onClick={() => void download()} disabled={exporting}>
          {exporting ? "Preparing…" : "Download my data"}
        </Button>
        <span className="text-xs text-zinc-500">
          One JSON file: your profile, documents, workspaces, sessions (transcripts, answers, reports) and usage.
        </span>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

/** A new password, with the current one. Every other device signs out; this one stays signed in. */
function PasswordChange() {
  const { user, setUser } = useAuth();
  const googleOnly = user?.has_password === false;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.changePassword(googleOnly ? "" : current, next);
      setUser(res.user);
      setDone(true);
      setCurrent("");
      setNext("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className={cx("mt-4 grid gap-3 border-t border-zinc-100 pt-4 sm:items-end dark:border-zinc-800", googleOnly ? "sm:grid-cols-[1fr_auto]" : "sm:grid-cols-[1fr_1fr_auto]")}>
      {googleOnly ? (
        <p className="text-sm text-zinc-600 sm:col-span-2 dark:text-zinc-300">
          You sign in with Google. Set a password if you also want to sign in with email.
        </p>
      ) : (
        <Field label="Current password" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
      )}
      <Field label={googleOnly ? "Password (10+ characters)" : "New password (10+ characters)"} htmlFor="pw-new">
        <Input id="pw-new" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" loading={busy} loadingText="Saving…" disabled={(!googleOnly && !current) || next.length < 10}>
        {googleOnly ? "Set password" : "Change password"}
      </Button>
      {done && (
        <p role="status" className="text-sm text-emerald-700 sm:col-span-full dark:text-emerald-300">
          Password changed. Every other device was signed out.
        </p>
      )}
      {error && (
        <div className="sm:col-span-full">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </form>
  );
}

/** Settings → Devices: where this account is signed in, and a way to sign out any one of them. */
function DevicesCard() {
  const devices = useAsync(() => api.devices(), [], "devices");
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const signOut = async (d: SignedInDevice) => {
    if (!(await confirmDialog({
      title: d.current ? "Sign out of this browser?" : `Sign out ${d.label}?`,
      body: d.current ? "You'll need to sign in again here." : "That device will need to sign in again. Anything open there stops working.",
      confirmLabel: "Sign out",
      danger: true,
    }))) return;
    setBusy(d.id);
    try {
      await api.signOutDevice(d.id);
      if (d.current) {
        await logout().catch(() => undefined);
        navigate("/login", { replace: true });
        return;
      }
      devices.setData((prev) => prev?.filter((x) => x.id !== d.id) ?? null);
      toast({ message: `${d.label} is signed out`, tone: "success" });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card id="devices" className="scroll-mt-24">
      <SectionTitle spot="devices" className="mb-1">
        Devices
      </SectionTitle>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">Where your account is signed in. Don't recognise one? Sign it out, then change your password.</p>
      <LoadGate loading={devices.loading && !devices.data} variant="line" count={2} label="Loading your devices">
        {devices.error && !devices.data ? (
          <ErrorNote onRetry={devices.reload}>{errorText(devices.error)}</ErrorNote>
        ) : devices.data && devices.data.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Devices show here from your next sign-in.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-white/10">
            {devices.data?.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {d.label}
                    {d.current && <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">This browser</span>}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Signed in {formatDate(d.created_at)} · last used {formatDate(d.last_seen_at)}
                  </p>
                </div>
                <Button size="sm" variant="secondary" loading={busy === d.id} onClick={() => void signOut(d)}>
                  Sign out
                </Button>
              </li>
            ))}
          </ul>
        )}
      </LoadGate>
    </Card>
  );
}

function PrivacyCard() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  if (!user) return null;

  const googleOnly = user.has_password === false;

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
      await api.deleteAccount(deletePassword);
      await logout().catch(() => undefined);
      navigate("/register", { replace: true });
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card id="privacy" className="scroll-mt-24">
      <SectionTitle spot="privacy" className="mb-4">
        Privacy
      </SectionTitle>
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
          {!deleting && (
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete account
            </Button>
          )}
        </div>
        {deleting && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void deleteAccount();
            }}
          >
            <Field label={googleOnly ? "Type your email to confirm" : "Your password, to delete the account"} htmlFor="delete-password">
              <Input
                id="delete-password"
                type={googleOnly ? "email" : "password"}
                autoComplete={googleOnly ? "off" : "current-password"}
                required
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="danger" disabled={!deletePassword}>
              Delete account
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
