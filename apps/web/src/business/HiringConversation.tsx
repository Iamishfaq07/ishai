import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { BizConversation } from "@orbit/types";
import { Button, Callout, Field, Textarea, confirmDialog } from "@orbit/ui";
import { hiringApi } from "./hiringApi";
import { errorText, Panel } from "./ui";

export function CandidateConversation({ token, canAsk }: { token: string; canAsk: boolean }) {
  return <Conversation key={token} token={token} cid="" aid="" canWrite={canAsk} />;
}
export function CompanyConversation({ cid, aid, canReply }: { cid: string; aid: string; canReply: boolean }) {
  return <Conversation key={`${cid}/${aid}`} token="" cid={cid} aid={aid} canWrite={canReply} />;
}

function Conversation({ token, cid, aid, canWrite }: { token: string; cid: string; aid: string; canWrite: boolean }) {
  const id = useId();
  const [data, setData] = useState<BizConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [load, setLoad] = useState(0);
  const requests = useRef<Record<string, string>>({});
  const loadPage = useCallback((before?: string) => token
    ? hiringApi.candidateConversation(token, before) : hiringApi.conversation(cid, aid, before), [token, cid, aid]);
  useEffect(() => {
    let live = true;
    setError(null);
    loadPage().then((next) => { if (live) setData(next); }).catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [loadPage, load]);
  useEffect(() => {
    if (!question && !Object.values(drafts).some(Boolean)) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [question, drafts]);
  const requestId = (key: string) => requests.current[key] ??= crypto.randomUUID();
  const older = async () => {
    if (!data?.next_before) return;
    setBusy("older"); setError(null);
    try {
      const next = await loadPage(data.next_before);
      setData((current) => current ? { ...current, next_before: next.next_before,
        threads: [...current.threads, ...next.threads.filter((t) => !current.threads.some((c) => c.id === t.id))] } : next);
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const ask = async () => {
    setBusy("ask"); setError(null); setNotice("");
    try {
      await hiringApi.clarify(token, question, requestId("ask"));
      setQuestion(""); delete requests.current.ask;
      setNotice("Your question is saved. The hiring team can reply here.");
      setLoad((n) => n + 1);
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const reply = async (qid: string) => {
    if (!(await confirmDialog({ title: "Publish this reply to the candidate?", body: "The candidate will see this text on their application page. Published replies cannot be overwritten.", confirmLabel: "Publish reply" }))) return;
    setBusy(qid); setError(null); setNotice("");
    try {
      const saved = await hiringApi.reply(cid, aid, qid, drafts[qid] ?? "", requestId(qid), notify[qid] ?? true);
      setData((current) => current ? { ...current, threads: current.threads.map((t) => t.id === qid ? { ...t, reply: saved.reply } : t) } : current);
      setDrafts((current) => ({ ...current, [qid]: "" }));
      delete requests.current[qid];
      setNotice("Reply published on the candidate's application page.");
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const writable = canWrite && !!data?.accepting;
  return <div className="space-y-5">
    <Panel title={token ? "Questions and replies" : "Candidate inbox"} hint={token
      ? "Ask about the interview or request clarification. The hiring team replies on this page."
      : "Replies here are visible to the candidate. Internal interview feedback stays in the debrief."}
      actions={<Button size="sm" variant="secondary" disabled={!!busy} onClick={() => setLoad((n) => n + 1)}>Refresh replies</Button>}>
      {!data && !error && <p role="status" className="text-sm text-zinc-500">Loading questions…</p>}
      {data && <div className="space-y-4">
        {data.threads.length === 0 && <p className="py-3 text-sm text-zinc-500">No questions yet.</p>}
        {data.threads.map((thread) => <article key={thread.id} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <div><h3 className="text-sm font-medium">{token ? "Your question" : "Candidate question"}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm">{thread.message}</p>
            <time dateTime={thread.created_at} className="mt-1 block text-xs text-zinc-500">{new Date(thread.created_at).toLocaleString()}</time></div>
          {thread.reply ? <div className="border-l-2 border-indigo-400 pl-3">
            <h3 className="text-sm font-medium">{token ? "Hiring team" : thread.reply.author ?? "Hiring team"}</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{thread.reply.message}</p>
            <time dateTime={thread.reply.created_at} className="mt-1 block text-xs text-zinc-500">{new Date(thread.reply.created_at).toLocaleString()}</time>
          </div> : !token && writable ? <form onSubmit={(e) => { e.preventDefault(); void reply(thread.id); }} className="space-y-3">
            <fieldset disabled={!!busy} className="space-y-3">
              <Field label="Reply to candidate" htmlFor={`${id}-${thread.id}`} hint="Publish only information intended for the candidate.">
                <Textarea id={`${id}-${thread.id}`} rows={3} minLength={10} maxLength={4000} required value={drafts[thread.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [thread.id]: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify[thread.id] ?? true} onChange={(e) => setNotify({ ...notify, [thread.id]: e.target.checked })} />Notify the candidate by email</label>
            </fieldset>
            <Button type="submit" size="sm" loading={busy === thread.id} disabled={!!busy && busy !== thread.id}>Publish reply</Button>
          </form> : <p className="text-xs text-zinc-500">Awaiting the hiring team's reply.</p>}
        </article>)}
        {data.next_before && <Button variant="secondary" size="sm" loading={busy === "older"} disabled={!!busy && busy !== "older"} onClick={() => void older()}>Load older questions</Button>}
      </div>}
      {token && writable && <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="mt-5 space-y-3">
        <Field label="Your question" htmlFor={`${id}-ask`}><Textarea id={`${id}-ask`} rows={3} minLength={10} maxLength={2000} required value={question} disabled={!!busy} onChange={(e) => setQuestion(e.target.value)} /></Field>
        <Button type="submit" variant="secondary" loading={busy === "ask"} disabled={!!busy && busy !== "ask"}>Send question to hiring team</Button>
      </form>}
      {notice && <p role="status" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{notice}</p>}
      {error && <Callout tone="error" className="mt-3">{error} Your unsent text is still here.</Callout>}
    </Panel>
    {token && data && <Panel title="Application activity" hint="Your latest 20 application updates.">
      {data.activity.length ? <ol className="space-y-4">{data.activity.map((event) => <li key={event.id} className="border-l-2 border-zinc-200 pl-3 text-sm dark:border-white/10">
        <p className="font-medium">{event.label}</p><time dateTime={event.created_at} className="mt-1 block text-xs text-zinc-500">{new Date(event.created_at).toLocaleString()}</time>
      </li>)}</ol> : <p className="text-sm text-zinc-500">No application updates yet.</p>}
    </Panel>}
  </div>;
}
