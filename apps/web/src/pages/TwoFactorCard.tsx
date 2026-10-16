import { useEffect, useState, type FormEvent } from "react";
import { Copy, KeyRound, LoadGate, QrCode, confirmDialog, toast } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

type Step = { kind: "idle" } | { kind: "password" } | { kind: "scan"; secret: string; uri: string } | { kind: "codes"; codes: string[] };

/**
 * Settings → Two-step sign-in: after the password (or Google), a 6-digit code from an authenticator app (Google
 * Authenticator, Microsoft Authenticator, 1Password…). Ten single-use recovery codes, shown once.
 */
export function TwoFactorCard() {
  const { user } = useAuth();
  const status = useAsync(() => api.twoFactorStatus(), [], "two-factor");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // The admin dashboard links here as /settings#two-step: bring the card into view once its status is in.
  const loaded = Boolean(status.data);
  useEffect(() => {
    if (loaded && window.location.hash === "#two-step") {
      document.getElementById("two-step")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loaded]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasPassword = user?.has_password !== false;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const begin = (e?: FormEvent) => {
    e?.preventDefault();
    void run(async () => {
      const r = await api.twoFactorSetup(password);
      setPassword("");
      setStep({ kind: "scan", secret: r.secret, uri: r.otpauth_uri });
    });
  };

  const turnOn = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.twoFactorEnable(code);
      setCode("");
      setStep({ kind: "codes", codes: r.recovery_codes });
      status.reload();
    });
  };

  const turnOff = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!(await confirmDialog({ title: "Turn off two-step sign-in?", body: "Your password alone will sign you in again.", confirmLabel: "Turn off", danger: true }))) return;
      await api.twoFactorDisable(code);
      setCode("");
      status.reload();
      toast({ message: "Two-step sign-in is off", tone: "success" });
    });
  };

  const newCodes = () => {
    void run(async () => {
      const r = await api.twoFactorNewCodes(code);
      setCode("");
      setStep({ kind: "codes", codes: r.recovery_codes });
      status.reload();
    });
  };

  const s = status.data;
  return (
    <Card id="two-step" className="scroll-mt-24">
      <h2 className="mb-1 flex items-center gap-2.5 font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
          <KeyRound className="h-4 w-4" aria-hidden />
        </span>
        Two-step sign-in
      </h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        After your password (or Google), a 6-digit code from an authenticator app on your phone. Someone with your password alone can't get in.
      </p>
      <LoadGate loading={status.loading && !s} variant="line" count={2} label="Checking two-step sign-in">
        {step.kind === "codes" ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Your recovery codes. Each works once, if you lose your phone. Save them somewhere safe now: they won't be shown again.</p>
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-500/5 p-3 font-mono text-sm sm:grid-cols-5">
              {step.codes.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(step.codes.join("\n")).then(() => toast("Copied"), () => toast({ message: "Couldn't copy", tone: "error" }));
                }}
              >
                <Copy className="h-4 w-4" aria-hidden /> Copy codes
              </Button>
              <Button onClick={() => setStep({ kind: "idle" })}>I've saved them</Button>
            </div>
          </div>
        ) : s?.enabled ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">On</span>{" "}
              {s.enabled_at && <>since {formatDate(s.enabled_at)} · </>}
              {s.recovery_left} recovery code{s.recovery_left === 1 ? "" : "s"} left
            </p>
            <form className="flex flex-wrap items-end gap-2" onSubmit={turnOff}>
              <Field label="A current code (or a recovery code)" htmlFor="tf-manage">
                <Input id="tf-manage" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Button type="button" variant="secondary" onClick={newCodes} disabled={busy || code.trim().length < 6}>New recovery codes</Button>
              <Button type="submit" variant="danger" disabled={busy || code.trim().length < 6}>Turn off</Button>
            </form>
          </div>
        ) : step.kind === "scan" ? (
          <form className="space-y-3" onSubmit={turnOn}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="rounded-xl bg-white p-2">
                <QrCode value={step.uri} size={160} label="QR code for your authenticator app" />
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p>1. Scan this with your authenticator app.</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Can't scan? Enter this key: <code className="break-all rounded bg-zinc-500/10 px-1 font-mono">{step.secret}</code>
                </p>
                <p className="mt-3">2. Enter the 6-digit code it shows.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Code" htmlFor="tf-code">
                <Input id="tf-code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} className="tracking-widest" />
              </Field>
              <Button type="submit" disabled={busy || code.trim().length < 6}>Turn on</Button>
              <Button type="button" variant="ghost" onClick={() => setStep({ kind: "idle" })}>Cancel</Button>
            </div>
          </form>
        ) : step.kind === "password" ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={begin}>
            <Field label="Your password, to start" htmlFor="tf-password">
              <Input id="tf-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy || !password}>Continue</Button>
            <Button type="button" variant="ghost" onClick={() => setStep({ kind: "idle" })}>Cancel</Button>
          </form>
        ) : (
          <Button onClick={() => (hasPassword ? setStep({ kind: "password" }) : begin())} disabled={busy}>
            Set up two-step sign-in
          </Button>
        )}
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      </LoadGate>
    </Card>
  );
}
