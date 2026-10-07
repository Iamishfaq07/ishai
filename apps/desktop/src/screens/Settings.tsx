import { useEffect, useState, type FormEvent } from "react";
import type { AdminConfig, AdminConfigUpdate, Entitlements, User } from "@orbit/types";
import {
  ArrowLeft,
  AppearanceControls,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  LatencyDiagnostics,
  CostDashboard,
  FeedbackDiagnostics,
  PageHeader,
  Select,
  Spinner,
  Toggle,
  useDesign, confirmDialog,
  Briefcase,
  CreditCard,
  FileText,
  ExternalLink,
  UserCog,
} from "@orbit/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WEB_URL, api } from "../api";
import { loadCloseAction, saveCloseAction, type CloseAction } from "../CloseDialog";
import { GlassControls } from "../GlassControls";
import { GlobalShortcutsCard } from "../GlobalShortcutsCard";
import { useTheme, type ThemePref } from "../theme";
import { TitleBar } from "../TitleBar";

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SettingsScreen({
  user,
  onUser,
  onSignOut,
  onBack,
}: {
  user: User;
  onUser: (u: User) => void;
  onSignOut: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <TitleBar title="Settings">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </TitleBar>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <PageHeader title="Settings" />
          <UsageCard />
          <PrivacyCard user={user} onUser={onUser} onSignOut={onSignOut} />
          <AppearanceCard />
          <GlobalShortcutsCard />
          <AdvancedCard />
        </div>
      </div>
    </div>
  );
}

function AppearanceCard() {
  const [theme, setTheme] = useTheme();
  const [design, setDesign] = useDesign();
  const [closeAction, setCloseAction] = useState<CloseAction>(loadCloseAction);
  return (
    <Card>
      <h2 className="mb-4 font-semibold">Appearance</h2>
      <div className="space-y-5">
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
        <AppearanceControls prefs={design} onChange={setDesign} />
        <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <GlassControls />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <label htmlFor="close-action" className="text-sm font-medium">
            When closing the window
          </label>
          <div className="w-44">
            <Select
              id="close-action"
              value={closeAction}
              onChange={(e) => {
                const v = e.target.value as CloseAction;
                setCloseAction(v);
                saveCloseAction(v);
              }}
            >
              <option value="ask">Ask every time</option>
              <option value="tray">Hide to tray</option>
              <option value="quit">Quit Orbit</option>
            </Select>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PrivacyCard({ user, onUser, onSignOut }: { user: User; onUser: (u: User) => void; onSignOut: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setPrivacy = async (patch: { store_transcripts?: boolean }) => {
    setSaving(true);
    setError(null);
    try {
      onUser(await api.updatePrivacy(patch));
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-4 font-semibold">Account &amp; privacy</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Signed in as <span className="font-medium text-zinc-700 dark:text-zinc-200">{user.email}</span>
      </p>
      <div className="space-y-4">
        <Toggle
          checked={user.store_transcripts}
          disabled={saving}
          onChange={(v) => void setPrivacy({ store_transcripts: v })}
          label="Store transcripts"
          description="Keep session transcripts in History. Off: used live and discarded when the session ends."
        />
        <p className="text-xs text-zinc-500">
          Screenshots are sent to the AI model to answer, then discarded — never stored. Raw audio is never stored.
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-white/[0.06]">
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void confirmDialog({
                title: "Sign out everywhere?",
                body: "Every device signed in to this account — this app, browsers, other computers — is signed out.",
                confirmLabel: "Sign out everywhere",
                danger: true,
              }).then(async (ok) => {
                if (!ok) return;
                try {
                  await api.logoutAll();
                } catch (err) {
                  setError(errText(err));
                  return;
                }
                onSignOut();
              })
            }
          >
            Sign out everywhere
          </Button>
        </div>
        {/* Account management the desktop app doesn't duplicate: one click to the same page in the browser. */}
        <div className="rounded-xl bg-zinc-500/5 p-3 ring-1 ring-zinc-200 dark:ring-white/[0.06]">
          <p className="text-sm font-medium">More account options</p>
          <p className="mt-0.5 text-xs text-zinc-500">Open in your browser, signed in to the same account.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void openUrl(`${WEB_URL}/billing`)}>
              <CreditCard className="h-3.5 w-3.5" />
              Your payments
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void openUrl(`${WEB_URL}/resume-ai`)}>
              <FileText className="h-3.5 w-3.5" />
              Resume AI
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void openUrl(`${WEB_URL}/jobs`)}>
              <Briefcase className="h-3.5 w-3.5" />
              Jobs AI
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void openUrl(`${WEB_URL}/settings`)}>
              <UserCog className="h-3.5 w-3.5" />
              Change email · download my data · delete account
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function UsageCard() {
  const [usage, setUsage] = useState<Entitlements | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .entitlements()
      .then(setUsage)
      .catch((e) => setError(errText(e)));
  };
  useEffect(load, []);

  const line = (used: number, limit: number | null, unit: string) =>
    limit === null ? `${used} ${unit} used (unlimited)` : `${used} / ${limit} ${unit} used`;
  const credits = usage?.credits ?? null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{credits ? "Credits" : "Usage"}</h2>
        <Button variant="secondary" size="sm" onClick={() => void openUrl(`${WEB_URL}/billing`)}>
          <CreditCard className="h-3.5 w-3.5" />
          {credits ? "Buy credits" : "Plan & billing"}
          <ExternalLink className="h-3 w-3 opacity-60" />
        </Button>
      </div>
      {usage === null ? (
        error ? (
          <ErrorNote onRetry={load}>{error}</ErrorNote>
        ) : (
          <Spinner />
        )
      ) : credits ? (
        <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
          <div className="flex items-baseline justify-between gap-3">
            <span>
              Interview minutes
              <span className="block text-xs text-zinc-500">Live and mock interviews both use these.</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums text-zinc-900 dark:text-white">
              {Math.round(credits.interview_minutes_left)} min left
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span>
              Resume AI credits
              <span className="block text-xs text-zinc-500">One per AI rewrite, tailoring, import or cover letter.</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums text-zinc-900 dark:text-white">
              {credits.resume === null ? "Unlimited" : `${credits.resume} left`}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Credits never expire. Each session can run up to {usage.limits.max_session_minutes} minutes. Packs are paid by
            UPI in your browser and land here once approved.
          </p>
        </div>
      ) : (
        <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            Plan: <span className="font-medium text-zinc-900 dark:text-white">{usage.label}</span>
          </p>
          <p>{line(Math.round(usage.usage.live_minutes), usage.limits.live_minutes, "live minutes")}</p>
          <p>{line(Math.round(usage.usage.mock_minutes), usage.limits.mock_minutes, "mock interview minutes")}</p>
          <p>{line(usage.usage.screenshots, usage.limits.screenshots, "screenshots")}</p>
          <p className="text-xs text-zinc-500">Sessions can run up to {usage.limits.max_session_minutes} minutes.</p>
        </div>
      )}
    </Card>
  );
}

/** Admin-only: rotate provider API keys / models for the whole workspace. */
function AdvancedCard() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .adminStatus()
      .then((s) => setIsAdmin(s.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  if (isAdmin === null || isAdmin === false) return null;
  return (
    <>
      <AdvancedConfig />
      <Card>
        <LatencyDiagnostics load={api.getLatency} />
      </Card>
      <Card>
        <FeedbackDiagnostics load={api.getFeedbackReport} />
      </Card>
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
  const [form, setForm] = useState<AdminConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deepseekKey, setDeepseekKey] = useState("");
  const [deepgramKey, setDeepgramKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = () => {
    setLoadError(null);
    api
      .getAdminConfig()
      .then(setForm)
      .catch((e) => setLoadError(errText(e)));
  };
  useEffect(load, []);

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
      setForm(await api.updateAdminConfig(update));
      setDeepseekKey("");
      setDeepgramKey("");
      setSaved(true);
    } catch (err) {
      setError(errText(err));
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
      setError(errText(err));
    }
  };

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold">Advanced (admin)</h2>
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
      </div>
      <p className="mb-4 text-sm text-zinc-500">Provider keys and models for the whole workspace. Applies to new answers immediately.</p>
      {form === null ? (
        loadError ? (
          <ErrorNote onRetry={load}>{loadError}</ErrorNote>
        ) : (
          <Spinner />
        )
      ) : (
        <form onSubmit={(e) => void save(e)} className="space-y-5">
          {error && <ErrorNote>{error}</ErrorNote>}
          {!form.secrets_editable && (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              Set <code>ORBIT_CONFIG_SECRET</code> on the server to store API keys here. Until then, keys come from the server environment.
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Answer provider" htmlFor="llm">
              <Select id="llm" value={form.llm_provider} onChange={(e) => set({ llm_provider: e.target.value })}>
                {PROVIDER_OPTS.llm.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Transcription provider" htmlFor="stt">
              <Select id="stt" value={form.stt_provider} onChange={(e) => set({ stt_provider: e.target.value })}>
                {PROVIDER_OPTS.stt.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <SecretField label="DeepSeek API key" id="ds-key" isSet={form.deepseek_api_key_set} disabled={!form.secrets_editable} value={deepseekKey} onChange={setDeepseekKey} onClear={() => void clearKey("deepseek_api_key")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="DeepSeek model" htmlFor="ds-model">
              <Input id="ds-model" value={form.deepseek_model} onChange={(e) => set({ deepseek_model: e.target.value })} />
            </Field>
            <Field label="DeepSeek reasoning model" htmlFor="ds-rmodel">
              <Input id="ds-rmodel" value={form.deepseek_reasoning_model} onChange={(e) => set({ deepseek_reasoning_model: e.target.value })} />
            </Field>
          </div>
          <Field label="DeepSeek base URL" htmlFor="ds-url">
            <Input id="ds-url" value={form.deepseek_base_url} onChange={(e) => set({ deepseek_base_url: e.target.value })} />
          </Field>

          <SecretField label="Deepgram API key" id="dg-key" isSet={form.deepgram_api_key_set} disabled={!form.secrets_editable} value={deepgramKey} onChange={setDeepgramKey} onClear={() => void clearKey("deepgram_api_key")} />
          <Field label="Deepgram model" htmlFor="dg-model">
            <Input id="dg-model" value={form.deepgram_model} onChange={(e) => set({ deepgram_model: e.target.value })} />
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
    <Field label={label} htmlFor={id} hint={isSet ? "A key is set. Enter a new one to rotate it." : "No key set — enter one to enable this provider."}>
      <div className="flex items-center gap-2">
        <Input id={id} type="password" autoComplete="off" placeholder={isSet ? "•••••••• (unchanged)" : "Paste API key"} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        {isSet && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </Field>
  );
}
