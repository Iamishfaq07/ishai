import { useEffect, useId, useState } from "react";
import type { BizCandidateSample, BizSampleSubmission } from "@orbit/types";
import { Button, Callout, Field, Select, Textarea, confirmDialog } from "@orbit/ui";
import { hiringApi } from "./hiringApi";
import { CandidateConversation } from "./HiringConversation";
import { validateSample } from "./hiringModel";
import { errorText, Panel } from "./ui";

export function CandidateChallenge({ token, confirmed, deletionRequested }: { token: string; confirmed: boolean; deletionRequested: boolean }) {
  const id = useId();
  const [data, setData] = useState<BizCandidateSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<BizSampleSubmission>({ response: "", explanation: "", assistance: "none" });
  const [load, setLoad] = useState(0);
  useEffect(() => {
    if (!answer.response && !answer.explanation) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [answer]);
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    hiringApi.sample(token).then((s) => { if (live) setData(s); })
      .catch((e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [token, confirmed, load]);
  const sample = data?.sample;
  const followUp = !!sample?.answer;
  const accepting = !!data?.accepting && confirmed && !deletionRequested;
  const submit = async () => {
    if (!sample) return;
    const invalid = validateSample(answer);
    if (invalid) { setError(invalid); return; }
    if (!(await confirmDialog({ title: followUp ? "Submit your adaptation?" : "Submit your initial solution?", body: "Your submission will be saved as an original record and cannot be overwritten. Copy a version for yourself if you would like one.", confirmLabel: "Submit solution" }))) return;
    setBusy(true); setError(null);
    try {
      setData(await hiringApi.submitSample(token, answer, sample.revision, followUp));
      setAnswer({ response: "", explanation: "", assistance: "none" });
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <div className="mt-6 space-y-5">
    {data?.interview_brief && <Panel title="Prepare for the conversation" hint="What this hiring team plans to assess.">
      <p className="whitespace-pre-wrap text-sm">{data.interview_brief.intro}</p>
      <ul className="mt-3 flex flex-wrap gap-2">{data.interview_brief.areas.map((area) => <li key={area} className="rounded-lg bg-zinc-100 px-3 py-1 text-sm dark:bg-white/5">{area}</li>)}</ul>
      <p className="mt-3 text-xs text-zinc-500">{data.interview_brief.stages.map((s) => `${s.name}: about ${s.minutes} min`).join(" · ")}</p>
    </Panel>}
    {sample && <Panel title={sample.brief.title} hint={`About ${sample.brief.time_box_min} minutes · Practical challenge`}>
      <div className="space-y-4">
        <p className="whitespace-pre-wrap text-sm">{sample.brief.brief}</p>
        <Callout tone="info">{sample.brief.candidate_guidance} The initial answer and a follow-up about a changed constraint are saved separately. A person reviews your reasoning.</Callout>
        {sample.answer && <details className="rounded-xl border border-zinc-200 p-3 dark:border-white/10"><summary className="cursor-pointer text-sm font-medium">Your saved initial solution</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{sample.answer.response}</p><p className="mt-2 whitespace-pre-wrap text-sm">{sample.answer.explanation}</p><p className="mt-2 text-xs text-zinc-500">Assistance: {sample.answer.assistance}</p></details>}
        {sample.change_request && <div className="rounded-xl border border-indigo-200 p-4 dark:border-indigo-400/25"><h3 className="font-semibold">A changed constraint</h3><p className="mt-2 whitespace-pre-wrap text-sm">{sample.change_request}</p><p className="mt-2 text-xs text-zinc-500">Explain what you would change and why. Your first solution stays intact.</p></div>}
        {sample.follow_up ? <div role="status"><h3 className="font-medium">Both responses are saved</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{sample.follow_up.response}</p><p className="mt-2 whitespace-pre-wrap text-sm">{sample.follow_up.explanation}</p><p className="mt-2 text-xs text-zinc-500">Assistance: {sample.follow_up.assistance}. The hiring team can now discuss your work with you.</p></div> : accepting ? <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
          <fieldset disabled={busy} className="space-y-3">
            <Field label={followUp ? "Your adaptation" : "Your solution"} htmlFor={`${id}-response`} hint="Plain text, notes or code. Use fictional data and keep a copy before leaving this page.">
              <Textarea id={`${id}-response`} rows={9} minLength={40} maxLength={20000} required value={answer.response} onChange={(e) => setAnswer({ ...answer, response: e.target.value })} />
            </Field>
            <Field label="Explain your decisions and trade-offs" htmlFor={`${id}-why`}><Textarea id={`${id}-why`} rows={4} minLength={30} maxLength={6000} required value={answer.explanation} onChange={(e) => setAnswer({ ...answer, explanation: e.target.value })} /></Field>
            <Field label="What assistance did you use?" htmlFor={`${id}-tools`} hint="Disclose the main source of help and describe other help in your explanation. This is not an automated cheating score.">
              <Select id={`${id}-tools`} value={answer.assistance} onChange={(e) => setAnswer({ ...answer, assistance: e.target.value as BizSampleSubmission["assistance"] })}><option value="none">No assistance</option><option value="documentation">Documentation and references</option><option value="ai">AI tools</option><option value="collaboration">Help from another person</option></Select>
            </Field>
          </fieldset>
          <Button type="submit" loading={busy}>{followUp ? "Submit adaptation" : "Submit initial solution"}</Button>
        </form> : <Callout tone="info">{!confirmed ? "Confirm your email above to submit." : "This application is no longer collecting new work."}</Callout>}
      </div>
    </Panel>}
    <CandidateConversation token={token} canAsk={confirmed && !deletionRequested} />
    {error && <Callout tone="error">{error} {!data && <Button variant="ghost" size="sm" onClick={() => setLoad((n) => n + 1)}>Retry</Button>}</Callout>}
  </div>;
}
