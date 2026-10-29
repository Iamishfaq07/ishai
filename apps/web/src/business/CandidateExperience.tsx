import { useEffect, useRef, useState } from "react";
import type { BizCandidateExperience } from "@orbit/types";
import { Button, Callout, Field, Select, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { experience } from "./experienceApi";
import { LoadError, Loading, Panel, errorText } from "./ui";

export function CandidateExperience({ token, confirmed, deletionRequested }: { token: string; confirmed: boolean; deletionRequested: boolean }) {
  const [data, setData] = useState<BizCandidateExperience | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [priority, setPriority] = useState("none");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const id = useRef(crypto.randomUUID());
  const live = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    live.current = true;
    if (confirmed) void experience.own(token).then(next => { if (live.current) { setData(next); setError(null); } }).catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); });
    return () => { live.current = false; };
  }, [token, confirmed, deletionRequested]);
  const run = async (action: "submit" | "withdraw" | "refresh") => {
    if (locked.current || !data) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const next = action === "submit" ? await experience.answer(token, id.current, data.notice_version, ratings, priority) : action === "withdraw" ? await experience.withdraw(token) : await experience.own(token);
      if (live.current) { setData(next); setChecked(false); }
    } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  if (!confirmed) return null;
  if (!data) return error ? <LoadError error={error} /> : <Loading label="Loading optional experience feedback" />;
  return <Panel title="Your hiring experience" hint="Optional feedback about the process, separate from your application and interview assessments.">
    {error && <LoadError error={error} />}
    {data.state === "available" ? <>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{data.notice}</p>
      <fieldset disabled={busy || deletionRequested} className="space-y-4"><legend className="sr-only">Process feedback</legend>
        {Object.entries(data.questions).map(([key, label]) => <Field key={key} label={label} htmlFor={`experience-${key}`}><Select id={`experience-${key}`} value={ratings[key] ?? ""} onChange={e => setRatings(current => ({ ...current, [key]: Number(e.target.value) }))}><option value="">Choose a response</option><option value="1">1 · Strongly disagree</option><option value="2">2 · Disagree</option><option value="3">3 · Neither agree nor disagree</option><option value="4">4 · Agree</option><option value="5">5 · Strongly agree</option></Select></Field>)}
        <Field label="What should the team improve first?" htmlFor="experience-priority"><Select id="experience-priority" value={priority} onChange={e => setPriority(e.target.value)}>{Object.entries(data.priorities).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</Select></Field>
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className={`mt-1 ${focusRing}`} checked={checked} onChange={e => setChecked(e.target.checked)} />I read the notice and choose to share this process feedback.</label>
      </fieldset>
      <div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy || deletionRequested || !checked || Object.keys(data.questions).some(key => !ratings[key])} onClick={() => void run("submit")}>Submit optional feedback</Button><Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Decline this optional feedback invitation? No response will be saved and you cannot use it again.")) void run("withdraw"); }}>Decline feedback invitation</Button></div>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Invitation expires {data.expires_at ? new Date(data.expires_at).toLocaleDateString() : "when this request closes"}. You can remove submitted feedback, but cannot edit or submit it again.</p>
    </> : data.state === "submitted" ? <div className="space-y-3"><Callout tone="success">Your feedback is saved. It did not change your application or assessment.</Callout><p className="text-sm">{data.notice}</p><ul className="space-y-2 text-sm">{Object.entries(data.response?.ratings ?? {}).map(([key, value]) => <li key={key}>{data.questions[key]} · {value}/5</li>)}</ul><p className="text-sm">Requested improvement: {data.priorities[data.response?.improvement ?? "none"]}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => { if (window.confirm("Remove your process feedback? Its reporting group will stop contributing, and you cannot submit again.")) void run("withdraw"); }}>Remove my feedback</Button><Button variant="ghost" onClick={() => downloadText("orbit-my-process-feedback.json", JSON.stringify({ notice: data.notice, notice_version: data.notice_version, questions: data.questions, response: data.response, exported_at: new Date().toISOString() }, null, 2), "application/json")}>Download my feedback</Button></div></div> : <p className="text-sm">{data.state === "removed" ? "Your feedback was removed or its retention period ended. It no longer contributes to reports, and this invitation cannot be used again." : data.state === "declined" ? "You declined this optional invitation. No response was saved, and your application is unchanged." : "This feedback invitation is closed or unavailable. Your application is unchanged."}</p>}
    <Button className="mt-3" variant="ghost" disabled={busy} onClick={() => void run("refresh")}>Refresh feedback invitation</Button>
  </Panel>;
}
