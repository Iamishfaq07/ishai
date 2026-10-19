import { useEffect, useId, useRef, useState } from "react";
import { Button, Callout, Field, Select, Textarea, confirmDialog } from "@orbit/ui";
import { candidateBase, cycleApi, staffBase, type SabaState } from "./sabaApi";
import { errorText, Panel } from "./ui";
import { api } from "../lib/api";
import { useBusinessDictation } from "./useBusinessDictation";
import { requestKey, type PendingRequests } from "./requestKey";

export function CandidateSaba({ token, readOnly = false }: { token: string; readOnly?: boolean }) {
  return <Saba key={token} base={candidateBase(token)} candidate readOnly={readOnly} />;
}
export function CompanySaba({ cid, aid, readOnly = false }: { cid: string; aid: string; readOnly?: boolean }) {
  return <Saba key={`${cid}/${aid}`} base={staffBase(cid, aid)} candidate={false} readOnly={readOnly} />;
}

function Saba({ base, candidate, readOnly }: { base: string; candidate: boolean; readOnly: boolean }) {
  const id = useId();
  const [data, setData] = useState<SabaState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [explanation, setExplanation] = useState("");
  const [agree, setAgree] = useState(false);
  const [network, setNetwork] = useState(false);
  const [networkConsent, setNetworkConsent] = useState(false);
  const [dictationApproved, setDictationApproved] = useState(false);
  const [disposition, setDisposition] = useState("inconclusive");
  const [notice, setNotice] = useState("");
  const [clip, setClip] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const dictation = useBusinessDictation(message, setMessage, data?.revision);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip); }, [clip]);
  useEffect(() => { setClip(null); }, [data?.revision]);
  const requests = useRef<PendingRequests>({});
  const sequence = useRef(0);
  useEffect(() => {
    let live = true;
    cycleApi.saba(base).then((s) => { if (live) setData(s); }).catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; sequence.current = -1; window.speechSynthesis?.cancel(); };
  }, [base]);
  useEffect(() => {
    if (!message && !explanation) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [message, explanation]);
  const refresh = async () => {
    setBusy(true); setError("");
    try { setData(await cycleApi.saba(base)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const act = async (action: string, body: object = {}) => {
    if (readOnly) { setError("This interview is available for reading only."); return; }
    if (action === "answers" && !(await confirmDialog({ title: "Save this interview answer?", body: "Your original answer cannot be overwritten. Review the text before sharing it with the employer.", confirmLabel: "Save answer" }))) return;
    setBusy(true); setError(""); setNotice("");
    const current = ++sequence.current;
    try {
      const next = await cycleApi.action(base, action, { ...body, request_id: requestKey(requests.current, action, body) });
      if (sequence.current !== current) return;
      setData(next); delete requests.current[action];
      if (action === "answers") { setMessage(""); window.speechSynthesis?.cancel(); }
      if (["alternative", "explanation", "integrity-review"].includes(action)) setExplanation("");
      setNotice("Saved. Your application status has not been changed by this action.");
    } catch (e) { if (sequence.current === current) setError(errorText(e)); }
    finally { if (sequence.current === current) setBusy(false); }
  };
  if (!data && !error) return <p role="status" className="text-sm text-zinc-500">Loading Business Saba…</p>;
  if (candidate && data && !data.invited) return null;
  const open = data?.status === "invited" || data?.status === "in_progress";
  const speak = () => {
    if (!data?.prompt || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(data.prompt);
    speech.lang = "en-US";
    window.speechSynthesis.speak(speech);
  };
  const naturalVoice = async () => {
    dictation.stop();
    setBusy(true); setError("");
    const current = ++sequence.current;
    try {
      const voice = await api.call<{ audio_b64: string; media_type: string }>(`${base}/saba/speech`, {
        method: "POST", body: JSON.stringify({ revision: data?.revision }),
      });
      if (sequence.current !== current) return;
      const bytes = Uint8Array.from(atob(voice.audio_b64), (c) => c.charCodeAt(0));
      setClip(URL.createObjectURL(new Blob([bytes], { type: voice.media_type })));
    } catch (e) { if (sequence.current === current) setError(errorText(e)); }
    finally { if (sequence.current === current) setBusy(false); }
  };
  const dictate = async () => {
    if (dictation.listening) { dictation.stop(); return; }
    if (!dictationApproved && !(await confirmDialog({ title: "Use your browser's speech recognition?", body: "Your browser may send microphone audio to its speech provider. Orbit receives only the text you review and explicitly save. You can type instead.", confirmLabel: "Start dictation" }))) return;
    setDictationApproved(true);
    audio.current?.pause(); window.speechSynthesis?.cancel(); dictation.start();
  };
  return <Panel title={candidate ? "Your interview with Saba" : "Saba for Business"} hint="Employer-led screening with a saved transcript. A person makes hiring decisions."
    actions={<Button variant="secondary" size="sm" disabled={busy} onClick={() => void refresh()}>Refresh interview</Button>}>
    {data && !data.invited && <div className="space-y-3"><p className="text-sm">Invite Saba to ask up to three assessment areas and their approved follow-up questions from the saved interview plan. The invitation lasts seven days.</p><Button loading={busy} onClick={() => void act("invite")}>Invite to Saba interview</Button></div>}
    {data?.invited && <fieldset disabled={readOnly || busy} className="space-y-5">
      <p className="text-sm font-medium">{data.status?.replaceAll("_", " ")} · {data.revision}/{data.total} answers saved</p>
      <progress value={data.revision ?? 0} max={data.total ?? 1} aria-label="Interview answers saved" className="h-2 w-full accent-indigo-600" />
      <p className="text-sm">{data.introduction}</p>
      {!candidate && !readOnly && data.status === "expired" && <Button variant="secondary" loading={busy} onClick={() => void act("renew")}>Extend invitation by seven days</Button>}
      {candidate && data.status === "invited" && <div className="space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{data.notice}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I agree to this interview and transcript processing.</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={network} onChange={(e) => setNetwork(e.target.checked)} />Also share network country observations for review (optional).</label>
        <Button disabled={!agree} loading={busy} onClick={() => void act("start", { consent: agree, notice_version: data.notice_version, share_network_country: network })}>Begin interview</Button>
      </div>}
      {candidate && data.prompt && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void act("answers", { message, base_revision: data.revision }); }}>
        <Callout tone="info" title={`Question ${(data.revision ?? 0) + 1}`}>{data.prompt}</Callout>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" type="button" loading={busy} onClick={() => void naturalVoice()}>Hear Saba</Button>{typeof speechSynthesis !== "undefined" && <Button variant="ghost" type="button" onClick={speak}>Use device voice</Button>}</div>{clip && <audio ref={audio} controls src={clip} aria-label="Saba reads the current interview question" className="w-full" />}
        <Field label="Your answer" htmlFor={`${id}-answer`} hint="Type or use your device's dictation. Review dictated text before saving. Orbit saves reviewed text. Optional dictation may use your browser's speech provider.">
          <Textarea id={`${id}-answer`} minLength={30} maxLength={6000} rows={7} required disabled={busy || dictation.listening} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field><div className="flex flex-wrap items-center gap-2">{dictation.supported && <Button variant="secondary" type="button" onClick={() => void dictate()}>{dictation.listening ? "Stop dictation" : "Dictate your answer"}</Button>}<Button type="submit" loading={busy} disabled={dictation.listening}>Save answer and continue</Button></div>{dictation.listening && <p role="status" className="text-sm">Listening. Stop dictation and review the text before saving.</p>}{dictation.error && <Callout tone="info">{dictation.error}</Callout>}
      </form>}
      {!!data.transcript?.length && <details><summary className="cursor-pointer text-sm font-medium">Saved interview transcript</summary><ol className="mt-4 space-y-4">{data.transcript.map((turn) => <li key={turn.id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10"><h3 className="text-sm font-medium">{turn.criterion} · {turn.question}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{turn.answer}</p></li>)}</ol></details>}
      {candidate && open && <details><summary className="cursor-pointer text-sm font-medium">Request another interview format</summary><form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void act("alternative", { message: explanation }); }}><p className="text-sm text-zinc-500">This pauses the Saba interview and asks the team to arrange an alternative. You do not need to share medical or other sensitive details.</p><Field label="Request for the hiring team" htmlFor={`${id}-alternative`}><Textarea id={`${id}-alternative`} required minLength={12} maxLength={2000} value={explanation} onChange={(e) => setExplanation(e.target.value)} /></Field><Button type="submit" loading={busy}>Request alternative</Button></form></details>}
      {!candidate && !readOnly && data.alternative && <Callout tone="info" title="Arrange an alternative interview">{data.alternative}</Callout>}
      <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-white/10">
        <h3 className="font-medium">Interview integrity evidence</h3>
        <p className="mt-2">Network country observations: {data.network_countries?.join(", ") || "Unavailable or not shared"}.</p>
        {candidate && data.network_shared && <Button variant="secondary" size="sm" className="mt-3" loading={busy} onClick={() => void act("stop-country-sharing")}>Stop sharing network country</Button>}
        {candidate && data.started && !data.network_shared && <p className="mt-2 text-zinc-500">Future network country observations are off.</p>}
        {(data.network_countries?.length ?? 0) > 1 && <p className="mt-2">More than one network country was observed. Travel, corporate networks and routing can explain a change. Ask for context.</p>}
        <p className="mt-2 text-zinc-500">Identity has not been verified, and synthetic media has not been measured. Network checks, when shared, are limited observations. This text interview is not a deepfake or liveness test.</p>
        {data.network_check && <p className="mt-3">IPinfo snapshot: {data.network_check.status === "measured"
          ? [data.network_check.is_vpn && "VPN", data.network_check.is_proxy && "proxy", data.network_check.is_tor && "Tor", data.network_check.is_relay && "relay"].filter(Boolean).join(", ") || "No listed privacy service reported"
          : "Unavailable; no conclusion"}. This observation can be wrong and does not show dishonesty.</p>}
        {candidate && data.started && data.network_check_available && !data.network_check && <div className="mt-3 space-y-3">
          <label className="flex items-start gap-2"><input type="checkbox" checked={networkConsent} onChange={(e) => setNetworkConsent(e.target.checked)} />I agree to send my current IP address to IPinfo for a VPN/proxy/relay snapshot. Orbit saves the signals, not the raw IP address.</label>
          <Button variant="secondary" disabled={!networkConsent} loading={busy} onClick={() => void act("network-check", { consent: networkConsent, notice_version: data.notice_version })}>Run optional network check</Button>
        </div>}
        {data.integrity_review && <Callout className="mt-3" tone="info" title={`Human review: ${data.integrity_review.disposition.replaceAll("_", " ")}`}>
          {data.integrity_review.message}{data.integrity_review.outdated && <p className="mt-2">More answers arrived after this review.</p>}
        </Callout>}
        {data.explanations?.map((entry) => <p key={entry.id} className="mt-3 whitespace-pre-wrap break-words">Candidate context: {entry.message}</p>)}
        {data.status !== "invited" && <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void act(candidate ? "explanation" : "integrity-review", { message: explanation, ...(!candidate ? { disposition, base_revision: data.revision } : {}) }); }}>
          {!candidate && !readOnly && <Field label="Human review outcome" htmlFor={`${id}-disposition`}><Select id={`${id}-disposition`} value={disposition} onChange={(e) => setDisposition(e.target.value)}><option value="inconclusive">Inconclusive</option><option value="needs_clarification">Ask for clarification</option><option value="explained">Context reviewed</option></Select></Field>}
          <Field label={candidate ? "Explain or challenge an observation" : "Message visible to the candidate"} htmlFor={`${id}-context`}><Textarea id={`${id}-context`} rows={3} required minLength={12} maxLength={2000} disabled={busy} value={explanation} onChange={(e) => setExplanation(e.target.value)} /></Field>
          <Button variant="secondary" type="submit" loading={busy}>{candidate ? "Share context with the team" : "Save human review"}</Button>
        </form>}
      </div>
      {!candidate && data.status === "completed" && (!readOnly || !!data.review) && <div className="space-y-3"><Button variant="secondary" loading={busy} onClick={() => void act("review")}>Find claims to clarify with AI</Button><p className="text-xs text-zinc-500">AI may miss or misread differences. Check every cited passage; this is not a fraud score or hiring recommendation.</p>{data.review && (data.review.items.length ? data.review.items.map((item, i) => <article key={i} className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-white/10"><h3 className="font-medium">{item.question}</h3><blockquote className="mt-2">{item.quote_a}</blockquote><blockquote className="mt-2">{item.quote_b}</blockquote></article>) : <p className="text-sm">The AI returned no supported clarification pairs. This does not verify the candidate's claims.</p>)}</div>}
    </fieldset>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {error && <Callout tone="error" className="mt-3">{error} Unsent text remains in this page.</Callout>}
  </Panel>;
}
