import { useState } from "react";
import type { SupportAdminItem, SupportThread } from "@orbit/ui";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { AdminTabs, when } from "./admin/shared";
import { Button, Input } from "../components/ui";

/** One tap for the replies that come up on almost every chat. */
const QUICK_REPLIES: { label: string; text: string }[] = [
  { label: "Ask for the UTR", text: "Please send the 12-digit UTR from your UPI app." },
  { label: "Credits added", text: "Your credits are on the account now. Refresh Plan & billing." },
  { label: "Not approved", text: "That payment was not approved. Send the right 12-digit UTR from Plan & billing." },
  { label: "Windows app", text: "The live copilot is the Windows app. While signed in, open Me, then Windows app." },
];

/** Chats a visitor handed to a person. A reply shows in their support window. */
export function AdminSupportPage() {
  const list = useAsync(() => api.adminSupport("waiting"), [], "admin-support");
  const [open, setOpen] = useState<SupportThread | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(item: SupportAdminItem) {
    setError("");
    setOpen(await api.adminSupportThread(item.id));
  }

  async function reply(preset?: string) {
    const line = (preset ?? text).trim();
    if (!open || !line) return;
    setBusy(true);
    setError("");
    try {
      setOpen(await api.adminSupportReply(open.id, line));
      if (!preset) setText("");
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the reply.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!open) return;
    setBusy(true);
    try {
      await api.adminSupportClose(open.id);
      setOpen(null);
      list.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't close it.");
    } finally {
      setBusy(false);
    }
  }

  const items = list.data ?? [];
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-semibold">Support</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Chats waiting for a person. Your reply shows in their window.</p>
      <div className="mt-4">
        <AdminTabs />
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_1fr]">
        <ul className="space-y-2">
          {list.error && <li className="text-sm text-red-600">Couldn't load chats.</li>}
          {!list.error && items.length === 0 && <li className="text-sm text-zinc-500">No one is waiting.</li>}
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => void choose(item)} className="w-full rounded-xl px-3 py-2 text-left ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-white/10 dark:hover:bg-white/5">
                <span className="block text-sm font-medium">{item.name || item.email || "Visitor"}</span>
                <span className="block truncate text-xs text-zinc-500">{item.preview}</span>
                <span className="block text-[11px] text-zinc-400">{when(item.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
        {open && (
          <div className="flex min-h-80 flex-col rounded-2xl ring-1 ring-zinc-200 dark:ring-white/10">
            {open.account && (
              <p className="border-b border-zinc-200 px-4 py-2 text-xs leading-relaxed text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                {open.account}
              </p>
            )}
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {open.messages.map((m) => (
                <p key={m.id} className="whitespace-pre-wrap text-sm">
                  <span className="font-medium capitalize">{m.role}. </span>
                  {m.text}
                </p>
              ))}
            </div>
            <form
              className="border-t border-zinc-200 p-3 dark:border-white/10"
              onSubmit={(e) => {
                e.preventDefault();
                void reply();
              }}
            >
              <div className="mb-2 flex flex-wrap gap-1.5">
                {QUICK_REPLIES.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={busy}
                    onClick={() => void reply(item.text)}
                    className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-40 dark:border-white/10 dark:text-zinc-200 dark:hover:border-indigo-400/40 dark:hover:bg-indigo-500/10"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Reply as Orbit"
                  aria-label="Reply"
                  maxLength={2000}
                  className="min-w-0 flex-1"
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy || !text.trim()}>
                    Send
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void close()} disabled={busy}>
                    Close
                  </Button>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
