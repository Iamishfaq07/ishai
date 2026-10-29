import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BizTalentOwn } from "@orbit/types";
import { Button, Field, Input, Textarea, buttonClass, focusRing } from "@orbit/ui";
import { downloadText } from "../lib/format";
import { talent } from "./talentApi";
import { LoadError, Panel, errorText } from "./ui";

export function CandidateTalent({ token, confirmed, deletionRequested }: { token: string; confirmed: boolean; deletionRequested: boolean }) {
  const [data, setData] = useState<BizTalentOwn | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; if (confirmed) void talent.own(token).then(next => { if (live.current) { setData(next); setError(null); } }).catch((e: unknown) => { if (live.current) setError(new Error(errorText(e))); }); return () => { live.current = false; }; }, [token, confirmed, deletionRequested]);
  if (!confirmed) return null;
  if (error && !data) return <LoadError error={error} />;
  if (!data || !data.items.length) return null;
  return <Panel title="Future opportunities" hint="Optional talent communities at this company. Joining never applies to another role.">
    <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{data.notice}</p>
    <div className="space-y-5">{data.items.map(pool => <Membership key={`${pool.id}:${pool.revision}:${pool.membership?.consented_at ?? "new"}`} token={token} pool={pool} noticeVersion={data.notice_version} disabled={deletionRequested} onSaved={next => { if (live.current) setData(next); }} />)}</div>
    <Button variant="ghost" className="mt-4" onClick={() => downloadText("orbit-my-talent-consent.json", JSON.stringify(data, null, 2), "application/json")}>Download my community data</Button>
  </Panel>;
}
function Membership({ token, pool, noticeVersion, disabled, onSaved }: { token: string; pool: BizTalentOwn["items"][number]; noticeVersion: string; disabled: boolean; onSaved: (next: BizTalentOwn) => void }) {
  const [skills, setSkills] = useState(pool.membership?.skills.join(", ") ?? "");
  const [interests, setInterests] = useState(pool.membership?.interests ?? "");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(crypto.randomUUID()); const locked = useRef(false); const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = async (leave: boolean, jobId = "") => {
    if (locked.current) return; locked.current = true; setBusy(true); setError(null);
    try {
      const next = jobId ? await talent.dismiss(token, pool.id, jobId) : leave ? await talent.leave(token, pool.id) : await talent.join(token, pool.id, { request_id: requestId.current, terms_revision: pool.terms_revision, notice_version: noticeVersion, acknowledge: checked, skills: skills.split(",").map(s => s.trim()).filter(Boolean), interests });
      onSaved(next); if (live.current) { setChecked(false); requestId.current = crypto.randomUUID(); }
    } catch (e) { if (live.current) setError(new Error(errorText(e))); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  return <section className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
    <h3 className="break-words font-semibold">{pool.name}</h3><p className="break-words text-sm">{pool.purpose}</p>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">Consent lasts {pool.retention_days} days or until the original application is deleted, whichever comes first.</p>
    {pool.membership && <p role="status" className="text-sm">{pool.active ? "Membership active" : "Membership paused or expired"} · expires {new Date(pool.membership.expires_at).toLocaleDateString()}</p>}
    {pool.available && <fieldset disabled={busy || disabled} className="space-y-3"><legend className="sr-only">Join {pool.name}</legend>
      <Field label="Your skills (comma separated, up to 12)" htmlFor={`talent-skills-${pool.id}`}><Input id={`talent-skills-${pool.id}`} value={skills} maxLength={732} onChange={e => { setSkills(e.target.value); requestId.current = crypto.randomUUID(); }} /></Field>
      <Field label="Roles and work you are interested in" htmlFor={`talent-interests-${pool.id}`}><Textarea id={`talent-interests-${pool.id}`} value={interests} minLength={10} maxLength={600} onChange={e => { setInterests(e.target.value); requestId.current = crypto.randomUUID(); }} /></Field>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className={`mt-1 ${focusRing}`} checked={checked} onChange={e => setChecked(e.target.checked)} />I read the notice and choose to share these details for future opportunities.</label>
      <Button disabled={busy || !checked || !skills.trim() || interests.trim().length < 10} onClick={() => void run(false)}>{pool.membership ? "Renew consent and save profile" : "Join talent community"}</Button>
      {pool.membership && <p className="text-xs text-zinc-500 dark:text-zinc-400">Renewal starts a new consent period and clears existing role suggestions.</p>}
    </fieldset>}
    {pool.suggestions.length > 0 && <div><h4 className="text-sm font-medium">Roles suggested by the recruiting team</h4><ul className="mt-2 space-y-2">{pool.suggestions.map(job => <li key={job.id}><Link className={buttonClass("secondary", "sm")} to={job.href}>Review {job.title}</Link><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(false, job.id)}>Dismiss suggestion for {job.title}</Button></li>)}</ul><p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Review the role and choose whether to submit a separate application.</p></div>}
    {error && <LoadError error={error} />}{pool.membership && <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Leave this community and delete your profile and role suggestions? Your original application stays as it is.")) void run(true); }}>Leave community and delete profile</Button>}
  </section>;
}
