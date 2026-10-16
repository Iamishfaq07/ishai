import { useState, type FormEvent } from "react";
import type { Passkey } from "@orbit/types";
import { Fingerprint, LoadGate, Pencil, Trash2, confirmDialog, createPasskey, cx, focusRing, passkeyErrorText, passkeysSupported, toast } from "@orbit/ui";
import { Button, Card, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText, formatDate } from "../lib/format";
import { useAsync } from "../lib/useAsync";

/**
 * Settings → Passkeys: sign in with the device's own unlock (fingerprint, face or PIN) instead of a password. Only the
 * public key reaches Orbit, and a passkey works only on Orbit's real site, so a fake sign-in page can't use it.
 */
export function PasskeysCard() {
  const { user } = useAuth();
  const list = useAsync(() => api.passkeys(), [], "passkeys");
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasPassword = user?.has_password !== false;
  const supported = passkeysSupported();

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

  const add = (e?: FormEvent) => {
    e?.preventDefault();
    void run(async () => {
      const { options } = await api.passkeyOptions(password);
      setPassword("");
      setAsking(false);
      let credential: Record<string, unknown>;
      try {
        credential = await createPasskey(options);
      } catch (err) {
        const text = passkeyErrorText(err);
        if (text) throw new Error(text, { cause: err });
        return; // cancelled
      }
      const added = await api.addPasskey(credential);
      list.setData((prev) => [...(prev ?? []), added]);
      toast({ message: `Passkey added: ${added.name}`, tone: "success" });
    });
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    void run(async () => {
      const saved = await api.renamePasskey(renaming.id, renaming.name.trim());
      list.setData((prev) => (prev ?? []).map((p) => (p.id === saved.id ? saved : p)));
      setRenaming(null);
    });
  };

  const remove = (p: Passkey) => {
    void run(async () => {
      const ok = await confirmDialog({
        title: `Remove "${p.name}"?`,
        body: "It stops signing you in to Orbit. Delete it from the device or password manager too, so it isn't offered any more.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      await api.removePasskey(p.id);
      list.setData((prev) => (prev ?? []).filter((x) => x.id !== p.id));
      toast("Passkey removed");
    });
  };

  const keys = list.data ?? [];
  return (
    <Card id="passkeys" className="scroll-mt-24">
      <h2 className="mb-1 flex items-center gap-2.5 font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
          <Fingerprint className="h-4 w-4" aria-hidden />
        </span>
        Passkeys
      </h2>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Sign in with your fingerprint, face or device PIN instead of a password. A passkey only works on Orbit's own site, so a fake sign-in page can't
        steal it, and it counts as both steps of two-step sign-in.
      </p>
      <LoadGate loading={list.loading && !list.data} variant="line" count={2} label="Loading your passkeys">
        {keys.length > 0 && (
          <ul className="mb-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-white/10 dark:border-white/10">
            {keys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                {renaming?.id === p.id ? (
                  <form className="flex flex-1 flex-wrap items-end gap-2" onSubmit={rename}>
                    <Field label="Name" htmlFor={`pk-name-${p.id}`}>
                      <Input id={`pk-name-${p.id}`} autoFocus maxLength={60} value={renaming.name} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
                    </Field>
                    <Button type="submit" disabled={busy || !renaming.name.trim()}>Save</Button>
                    <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Added {formatDate(p.created_at)} · {p.last_used_at ? `last used ${formatDate(p.last_used_at)}` : "not used yet"}
                        {p.backed_up && " · synced"}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Rename ${p.name}`}
                      onClick={() => setRenaming({ id: p.id, name: p.name })}
                      className={cx("rounded-lg p-2 text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200", focusRing)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${p.name}`}
                      disabled={busy}
                      onClick={() => remove(p)}
                      className={cx("rounded-lg p-2 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300", focusRing)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {!supported ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">This browser can't make passkeys. Recent Chrome, Edge, Safari and Firefox can.</p>
        ) : asking ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={add}>
            <Field label="Your password, to add one" htmlFor="pk-password">
              <Input id="pk-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy || !password}>Continue</Button>
            <Button type="button" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </form>
        ) : (
          <Button variant={keys.length ? "secondary" : "primary"} onClick={() => (hasPassword ? setAsking(true) : add())} disabled={busy}>
            {keys.length ? "Add another passkey" : "Add a passkey"}
          </Button>
        )}
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      </LoadGate>
    </Card>
  );
}
