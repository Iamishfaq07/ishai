import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { BizHiringCompare } from "@orbit/types";
import { ArrowLeft, Callout, cx, focusRing } from "@orbit/ui";
import { PageTitle, useCompany } from "./BusinessApp";
import { hiringApi } from "./hiringApi";
import { EvidenceOrbit } from "./HiringGraphics";
import { coverageCount, roomPath } from "./hiringModel";
import { jobPath } from "./model";
import { LoadError, Loading, Panel } from "./ui";

export function CandidateComparePage() {
  const { company } = useCompany();
  const { jid = "" } = useParams();
  const [params] = useSearchParams();
  const key = params.getAll("ids").join(",");
  const [data, setData] = useState<BizHiringCompare | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    hiringApi.compare(company.id, jid, key.split(",").filter(Boolean)).then((d) => { if (live) setData(d); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e : new Error(String(e))); });
    return () => { live = false; };
  }, [company.id, jid, key]);
  return <div className="space-y-5">
    <Link to={jobPath(company.id, jid)} className={cx("inline-flex items-center gap-2 rounded text-sm", focusRing)}><ArrowLeft className="h-4 w-4" /> Back to pipeline</Link>
    <PageTitle title="Compare evidence" subtitle={data?.job_title ?? "Selected applicants"} />
    <Callout tone="info">Compare the same job criteria. Missing evidence is visible, and no candidate is automatically declared the winner.</Callout>
    {error ? <LoadError error={error} /> : !data ? <Loading /> : <div className="grid gap-4 md:grid-cols-2">{data.people.map((person) => <Panel key={person.application_id} title={<Link to={roomPath(company.id, person.application_id)} className="underline">{person.name}</Link>} hint={person.reference}>
      <div className="mb-4 flex items-center gap-3"><EvidenceOrbit {...coverageCount(person.coverage)} /><p className="text-sm text-zinc-500">{person.gaps.length} evidence gaps to review</p></div>
      <div className="space-y-4">{person.coverage.map((c) => <section key={c.criterion_id}><h3 className="font-medium">{c.name}</h3>{c.spread >= 2 && <p className="text-xs text-amber-700 dark:text-amber-300">Panel disagreement</p>}
        {c.observations.length ? c.observations.map((o, i) => <blockquote key={i} className="mt-2 border-l-2 border-zinc-200 pl-3 text-sm dark:border-white/15"><p className="font-medium">{o.author} · {o.score}/4 · plan v{o.plan_revision}</p><p className="mt-1 whitespace-pre-wrap">{o.observation}</p></blockquote>) : <p className="mt-1 text-sm text-zinc-500">Unassessed</p>}
      </section>)}</div>
      {person.gaps.length > 0 && <details className="mt-5 text-sm"><summary className="cursor-pointer font-medium">Review evidence gaps</summary><ul className="mt-2 list-disc space-y-1 pl-4">{person.gaps.map((g) => <li key={g}>{g}</li>)}</ul></details>}
    </Panel>)}</div>}
  </div>;
}
