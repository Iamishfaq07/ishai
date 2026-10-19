import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Callout, Field, Input, buttonClass } from "@orbit/ui";
import { automationApi } from "./automationApi";
import { companyPath } from "./model";
import { Panel } from "./ui";

export function CandidateTask({ cid, aid }: { cid: string; aid: string }) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [request, setRequest] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(""); setSaved(false);
    try {
      await automationApi.create(cid, aid, { title, due_at: new Date(due).toISOString(),
        assignee_id: null, request_id: request });
      setTitle(""); setDue(""); setRequest(crypto.randomUUID()); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <Panel title="Hiring follow-up" hint="Create durable internal work for this application. Assign an owner from the automation center.">
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <Field label="Task" htmlFor={`${id}-title`}><Input id={`${id}-title`} required minLength={5} maxLength={180} value={title} disabled={busy}
        onChange={(e) => { setTitle(e.target.value); setRequest(crypto.randomUUID()); }} placeholder="Arrange a discussion about the work sample" /></Field>
      <Field label="Due (your local time)" htmlFor={`${id}-due`}><Input id={`${id}-due`} required type="datetime-local" value={due} disabled={busy}
        onChange={(e) => { setDue(e.target.value); setRequest(crypto.randomUUID()); }} /></Field>
      <Button type="submit" size="sm" disabled={busy} loading={busy}>Add follow-up</Button>
      {error && <Callout tone="error">{error}</Callout>}
      {saved && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Follow-up saved in the shared task queue.</p>}
    </form>
    <Link to={companyPath(cid, "automations")} className={`mt-3 ${buttonClass("ghost", "sm")}`}>Open automation center</Link>
  </Panel>;
}
