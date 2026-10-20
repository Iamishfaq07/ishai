import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { InboxMessage, InboxMessagePatch } from "@orbit/types";
import {
  Ban,
  Check,
  ExternalLink,
  Mail,
  MailOpen,
  MessageCircle,
  Phone,
  Reply,
  Save,
  Send,
  Sheet,
  Trash2,
  Undo2,
  LoadGate,
  UserRound,
  buttonClass,
  confirmDialog,
  cx,
  focusRing,
  toast,
} from "@orbit/ui";
import { Button, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { STATUS_LABEL, contextRows, greeting, mailtoReply, whatsappNumber } from "./inbox";
import { Section, Tag, when } from "./shared";

const REPLY_MAX = 5000;
const NOTE_MAX = 2000;

const STATUS_TONE: Record<InboxMessage["status"], string> = {
  new: "bg-indigo-500/10 text-indigo-800 ring-indigo-500/25 dark:text-indigo-200",
  open: "bg-amber-500/10 text-amber-900 ring-amber-500/25 dark:text-amber-200",
  done: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300",
  spam: "bg-rose-500/10 text-rose-800 ring-rose-500/25 dark:text-rose-300",
};

export function StatusBadge({ status }: { status: InboxMessage["status"] }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", STATUS_TONE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * One Contact message in full, in a panel over the Inbox: who wrote (and their account, when they were signed in),
 * what about (a reported job), the message, the replies sent, and what the admin can do: reply from Orbit (or from
 * their own mail app), mark it done, reopen, spam, mark unread, a private note, delete. Opening it marks it read;
 * `onChange` keeps the list's row in step, `onDeleted` takes it off.
 */
export function MessageDrawer({
  messageId,
  onClose,
  onChange,
  onDeleted,
}: {
  messageId: string;
  onClose: () => void;
  onChange: (m: InboxMessage) => void;
  onDeleted: (id: string) => void;
}) {
  const [m, setM] = useState<InboxMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const changedRef = useRef(onChange);
  changedRef.current = onChange;

  const load = useCallback(() => {
    setError(null);
    api
      .adminInboxMessage(messageId)
      .then((msg) => {
        setM(msg);
        setNote(msg.admin_note ?? "");
        setReply(greeting(msg.name));
        changedRef.current(msg); // opening it marked it read
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [messageId]);
  useEffect(() => {
    setM(null);
    load();
  }, [load]);

  const run = async (label: string, fn: () => Promise<InboxMessage>, done: string): Promise<InboxMessage | null> => {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      setM(next);
      changedRef.current(next);
      toast({ message: done, tone: "success" });
      return next;
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      setBusy(null);
    }
  };
  const patch = (label: string, body: InboxMessagePatch, done: string) => run(label, () => api.updateInboxMessage(messageId, body), done);

  const sendReply = async () => {
    const sent = await run("reply", () => api.replyInboxMessage(messageId, reply), m ? `Reply sent to ${m.email}` : "Reply sent");
    if (sent) setReply("");
  };
  const markUnread = async () => {
    if (await patch("unread", { status: "new" }, "Marked unread")) onClose();
  };
  const remove = async () => {
    if (!m) return;
    const ok = await confirmDialog({
      title: `Delete this message from ${m.name}?`,
      body: "It's gone for good, with your note and replies. The audit log keeps that it was deleted.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await api.deleteInboxMessage(messageId);
      toast({ message: "Message deleted" });
      onDeleted(messageId);
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  const whatsapp = whatsappNumber(m?.phone ?? null);
  const rows = contextRows(m?.context ?? null);
  const replyReady = Boolean(m) && reply.trim().length >= 2 && reply.trim() !== greeting(m?.name ?? "").trim();
  const handled = m?.status === "done" || m?.status === "spam";

  return (
    <Sheet
      open
      placement="end"
      onClose={onClose}
      titleId="message-drawer-title"
      title={m ? m.name : "Message"}
      detail={
        m ? (
          <>
            <p className="truncate text-sm text-zinc-600 dark:text-zinc-300">{m.email}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={m.status} />
              <Tag>{m.topic_label}</Tag>
              <span className="font-mono text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{m.reference}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Sent {when(m.created_at)}
              {m.handled_at && ` · ${m.status === "spam" ? "marked spam" : "done"} ${when(m.handled_at)}`}
            </p>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3 px-4 py-4 sm:px-5">
          {error && (
            <p role="alert" className="rounded-xl bg-rose-500/10 p-2.5 text-sm text-rose-800 ring-1 ring-rose-500/25 dark:text-rose-200">
              {error}{" "}
              {!m && (
                <button type="button" className="underline" onClick={load}>
                  Try again
                </button>
              )}
            </p>
          )}
          {!m ? (
            !error && <LoadGate loading variant="card" count={3} label="Opening the message">{null}</LoadGate>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {handled ? (
                  <Button size="sm" variant="secondary" loading={busy === "open"} onClick={() => void patch("open", { status: "open" }, "Moved back to To answer")}>
                    <Undo2 className="h-3.5 w-3.5" /> Reopen
                  </Button>
                ) : (
                  <Button size="sm" loading={busy === "done"} onClick={() => void patch("done", { status: "done" }, "Marked done")}>
                    <Check className="h-3.5 w-3.5" /> Mark done
                  </Button>
                )}
                {m.status !== "spam" && (
                  <Button size="sm" variant="secondary" loading={busy === "spam"} onClick={() => void patch("spam", { status: "spam" }, "Marked as spam")}>
                    <Ban className="h-3.5 w-3.5" /> Spam
                  </Button>
                )}
                <Button size="sm" variant="ghost" loading={busy === "unread"} onClick={() => void markUnread()}>
                  <MailOpen className="h-3.5 w-3.5" /> Mark unread
                </Button>
                <Button size="sm" variant="danger" className="ml-auto" loading={busy === "delete"} onClick={() => void remove()}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>

              <Section title="Message">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">{m.message}</p>
              </Section>

              {rows.length > 0 && (
                <Section title={m.topic === "report_job" ? "The reported job" : "Where it came from"}>
                  <dl className="space-y-1.5 text-sm">
                    {rows.map((r) => (
                      <div key={r.label} className="flex gap-3">
                        <dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">{r.label}</dt>
                        <dd className="min-w-0 break-words font-medium">
                          {r.href ? (
                            <a href={r.href} target="_blank" rel="noopener noreferrer nofollow" className={cx("inline-flex items-center gap-1 text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                              {r.value} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            </a>
                          ) : r.to ? (
                            <Link to={r.to} className={cx("text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                              Open in Jobs
                            </Link>
                          ) : (
                            r.value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              )}

              <Section title="Sender">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">Email</dt>
                    <dd className="min-w-0 break-all font-medium">{m.email}</dd>
                  </div>
                  {m.phone && (
                    <div className="flex gap-3">
                      <dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">Phone</dt>
                      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-medium">
                        <span className="tabular-nums">{m.phone}</span>
                        <a href={`tel:${m.phone.replace(/[^\d+]/g, "")}`} className={cx("inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                          <Phone className="h-3.5 w-3.5" aria-hidden /> Call
                        </a>
                        {whatsapp && (
                          <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className={cx("inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline dark:text-emerald-300", focusRing)}>
                            <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
                          </a>
                        )}
                      </dd>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">Account</dt>
                    <dd className="min-w-0">
                      {m.account ? (
                        <Link
                          to={`/admin/users?user=${encodeURIComponent(m.account.id)}`}
                          className={cx("inline-flex items-center gap-1 break-all font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}
                        >
                          <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden /> {m.account.email}
                        </Link>
                      ) : (
                        <span className="text-zinc-500 dark:text-zinc-400">Not signed in when they wrote</span>
                      )}
                    </dd>
                  </div>
                  {m.same_network_30d > 1 && (
                    <p className={cx("pt-1 text-xs", m.same_network_30d >= 5 ? "font-medium text-amber-800 dark:text-amber-200" : "text-zinc-500 dark:text-zinc-400")}>
                      {m.same_network_30d} messages from the same network in the last 30 days.
                    </p>
                  )}
                </dl>
              </Section>

              {m.replies.length > 0 && (
                <Section title={m.replies.length === 1 ? "Your reply" : `Your replies (${m.replies.length})`}>
                  <ol className="space-y-3">
                    {m.replies.map((r) => (
                      <li key={r.at} className="rounded-xl bg-indigo-500/[0.05] p-3 ring-1 ring-indigo-500/15">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {when(r.at)} · {r.by}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.text}</p>
                      </li>
                    ))}
                  </ol>
                </Section>
              )}

              <Section
                title="Reply"
                hint={
                  m.can_reply
                    ? `Emailed to ${m.email} from Orbit's address. Their answer comes to your own inbox. The message is then done.`
                    : "This server can't send email (no SMTP), so reply from your own mail app: it opens with the reply ready."
                }
              >
                <Textarea
                  aria-label={`Reply to ${m.name}`}
                  rows={6}
                  value={reply}
                  maxLength={REPLY_MAX}
                  onChange={(e) => setReply(e.target.value)}
                  className="resize-y"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {m.can_reply && (
                    <Button size="sm" loading={busy === "reply"} disabled={!replyReady} onClick={() => void sendReply()}>
                      <Send className="h-3.5 w-3.5" /> Send reply
                    </Button>
                  )}
                  <a href={mailtoReply(m, replyReady ? reply : "")} className={buttonClass(m.can_reply ? "secondary" : "primary", "sm")}>
                    {m.can_reply ? <Mail className="h-3.5 w-3.5" aria-hidden /> : <Reply className="h-3.5 w-3.5" aria-hidden />} Reply in your mail app
                  </a>
                </div>
              </Section>

              <Section title="Your note" hint="Private: never sent to them.">
                <Textarea aria-label="Your note" rows={3} value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} className="resize-y" />
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  loading={busy === "note"}
                  disabled={note.trim() === (m.admin_note ?? "")}
                  onClick={() => void patch("note", { admin_note: note }, note.trim() ? "Note saved" : "Note cleared")}
                >
                  <Save className="h-3.5 w-3.5" /> Save note
                </Button>
              </Section>
            </>
          )}
        </div>
    </Sheet>
  );
}
