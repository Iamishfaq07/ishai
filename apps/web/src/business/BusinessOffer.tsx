import { useEffect, useId, useRef, useState } from "react";
import { Button, Callout, Field, Input, Textarea, confirmDialog } from "@orbit/ui";
import { candidateBase, cycleApi, staffBase, type OfferSummary } from "./sabaApi";
import { errorText, Panel } from "./ui";

export function CandidateOffer({ token, readOnly = false }: { token: string; readOnly?: boolean }) {
  return <Offer key={token} base={candidateBase(token)} candidate readOnly={readOnly} />;
}
export function CompanyOffer({ cid, aid, readOnly = false }: { cid: string; aid: string; readOnly?: boolean }) {
  return <Offer key={`${cid}/${aid}`} base={staffBase(cid, aid)} candidate={false} readOnly={readOnly} />;
}
function Offer({ base, candidate, readOnly }: { base: string; candidate: boolean; readOnly: boolean }) {
  const id = useId();
  const [offer, setOffer] = useState<OfferSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agree, setAgree] = useState(false);
  const [draft, setDraft] = useState({ role: "", compensation: "", start_date: "", terms: "", expires_days: 7 });
  const requests = useRef<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    cycleApi.offer(base).then((s) => { if (live) { setOffer(s.offer); setLoaded(true); } })
      .catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [base]);
  useEffect(() => {
    if (!draft.role && !draft.compensation && !draft.start_date && !draft.terms) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);
  const act = async (action: string, body: object) => {
    if (readOnly) { setError("This offer is available for reading only."); return; }
    if (!(await confirmDialog({ title: action === "respond" ? "Save your offer response?" : action === "withdraw" ? "Withdraw this offer summary?" : "Publish this offer summary?", body: action === "respond" ? "Your response is saved against this exact version of the displayed terms. Contact the team for the formal agreement and next steps." : "The candidate can read this update on their private application page. Published versions and responses remain in the record.", confirmLabel: action === "respond" ? "Save response" : action === "withdraw" ? "Withdraw summary" : "Publish summary" }))) return;
    setBusy(true); setError(""); setNotice("");
    requests.current[action] ??= crypto.randomUUID();
    try {
      const result = await cycleApi.offerAction(base, action, { ...body, request_id: requests.current[action] });
      setOffer(result.offer); delete requests.current[action]; setAgree(false);
      if (!action) setDraft({ role: "", compensation: "", start_date: "", terms: "", expires_days: 7 });
      setNotice("Saved to the offer record. The hiring team arranges the next steps.");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setError("");
    try { setOffer((await cycleApi.offer(base)).offer); setLoaded(true); setAgree(false); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (candidate && loaded && !offer) return null;
  return <Panel title={candidate ? "Your offer" : "Offer and hiring handoff"} hint="A versioned offer summary and response. The employer provides the formal agreement and confirms the hire."
    actions={<Button variant="secondary" size="sm" disabled={busy} onClick={() => void refresh()}>Refresh offer</Button>}>
    {!loaded && !error && <p role="status" className="text-sm">Loading offer…</p>}
    {offer && <div className="space-y-3 text-sm">
      <p className="font-medium">Version {offer.revision} · {offer.status} · {offer.role}</p>
      <dl className="space-y-2"><div><dt className="font-medium">Compensation</dt><dd>{offer.compensation}</dd></div><div><dt className="font-medium">Proposed start</dt><dd>{offer.start_date}</dd></div><div><dt className="font-medium">Response deadline</dt><dd>{new Date(offer.expires_at).toLocaleString()}</dd></div></dl>
      <p className="whitespace-pre-wrap break-words">{offer.terms}</p>
      {offer.responded_at && <p>Response saved {new Date(offer.responded_at).toLocaleString()}.</p>}
      {candidate && !readOnly && offer.status === "pending" && <div className="space-y-3"><label className="flex items-start gap-2"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read this version of the offer summary.</label><div className="flex flex-wrap gap-2"><Button disabled={!agree} loading={busy} onClick={() => void act("respond", { offer_id: offer.id, response: "accepted", acknowledge: agree })}>Accept offer summary</Button><Button variant="secondary" disabled={!agree || busy} onClick={() => void act("respond", { offer_id: offer.id, response: "declined", acknowledge: agree })}>Decline offer summary</Button></div><p className="text-xs text-zinc-500">For changes or questions, use Questions and replies before responding.</p></div>}
      {!candidate && !readOnly && offer.status === "pending" && <Button variant="secondary" loading={busy} onClick={() => void act("withdraw", { offer_id: offer.id })}>Withdraw summary</Button>}
      {!candidate && offer.status === "accepted" && <Callout tone="success">The candidate accepted this summary. Arrange the formal agreement and onboarding, then mark the application hired from Application and scheduling.</Callout>}
    </div>}
    {!candidate && !readOnly && loaded && offer?.status !== "accepted" && <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">{offer ? "Publish revised offer terms" : "Prepare an offer summary"}</summary>
      <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void act("", { ...draft, base_offer_id: offer?.id ?? null }); }}>
        <fieldset disabled={busy} className="space-y-3">
          <Field label="Offered role" htmlFor={`${id}-role`}><Input id={`${id}-role`} minLength={2} maxLength={160} required value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} /></Field>
          <Field label="Compensation and currency" htmlFor={`${id}-pay`}><Input id={`${id}-pay`} minLength={3} maxLength={300} required value={draft.compensation} onChange={(e) => setDraft({ ...draft, compensation: e.target.value })} /></Field>
          <Field label="Proposed start date" htmlFor={`${id}-start`}><Input id={`${id}-start`} minLength={3} maxLength={120} required value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} /></Field>
          <Field label="Terms and next steps" htmlFor={`${id}-terms`}><Textarea id={`${id}-terms`} minLength={30} maxLength={5000} rows={5} required value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} /></Field>
          <Field label="Days to respond" htmlFor={`${id}-days`}><Input id={`${id}-days`} type="number" min={1} max={30} required value={draft.expires_days} onChange={(e) => setDraft({ ...draft, expires_days: Number(e.target.value) })} /></Field>
        </fieldset><Button type="submit" loading={busy}>Publish offer summary</Button>
      </form>
    </details>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {error && <Callout tone="error" className="mt-3">{error} Unsent terms remain here; refresh the offer before retrying a conflict.</Callout>}
  </Panel>;
}

