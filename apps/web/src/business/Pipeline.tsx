// Orbit for Business (D82): one job's applicants, as a board (a column per stage) or a list. Select several to move
// or reject them together. Knock-out failures are flagged and sorted last; nobody is ever rejected automatically:
// a person clicks Reject.
import { useCallback, useEffect, useId, useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { BizApplicationList, BizApplicationListItem, BizJobAnalytics, BizStage } from "@orbit/types";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  ChartColumn,
  Dialog,
  DialogActions,
  Download,
  EmptyState,
  Eye,
  EyeOff,
  Field,
  Input,
  List,
  PenLine,
  SearchInput,
  SegmentedControl,
  Select,
  Table,
  THead,
  Td,
  Textarea,
  Th,
  TriangleAlert,
  Tr,
  Users,
  buttonClass,
  cx,
  focusRing,
  safeLocal,
  toast,
} from "@orbit/ui";
import { biz } from "./api";
import { PageTitle, useCompany } from "./BusinessApp";
import { planPath } from "./hiringModel";
import { SourceTable, firstReply } from "./Dashboard";
import { applicationPath, applyMove, careersPath, downloadBlob, groupByStage, jobPath, matchLabel, neighbourStage, rejectedMessage, relTime, scoreTone, sortApplications, toggleId, type SortKey } from "./model";
import { JobStatusBadge, Loading, LoadError, Panel, errorText } from "./ui";

type View = "board" | "list";
const VIEW_KEY = "orbit.biz.pipelineView";

function ScoreBadge({ a }: { a: BizApplicationListItem }) {
  if (a.status === "withdrawn") return <Badge>Withdrawn</Badge>;
  if (a.ranking_status === "pending") return <Badge>Ranking…</Badge>;
  if (a.ranking_status === "failed" || a.score === null) return <Badge>Not ranked</Badge>;
  return (
    <span title="Orbit's ranking: how well the resume and answers match this job's must-haves and nice-to-haves. It only sorts; your team decides.">
      <Badge tone={scoreTone(a.score)}>{a.score}</Badge>
    </span>
  );
}

function Flags({ a }: { a: BizApplicationListItem }) {
  return (
    <>
      {a.knockout_failed && (
        <span title={a.knockout_reasons.join("; ")} className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlert className="h-3 w-3" aria-hidden /> Doesn't meet: {a.knockout_reasons[0] ?? "a screening answer"}
          {a.knockout_reasons.length > 1 ? ` +${a.knockout_reasons.length - 1}` : ""}
        </span>
      )}
      {!a.email_confirmed && <span className="text-xs text-zinc-500 dark:text-zinc-400">Email not confirmed</span>}
      {a.deletion_requested && <span className="text-xs text-rose-700 dark:text-rose-300">Asked to be deleted</span>}
    </>
  );
}

function Card({
  a,
  cid,
  stages,
  selected,
  onSelect,
  onMove,
  canMove,
}: {
  a: BizApplicationListItem;
  cid: string;
  stages: BizStage[];
  selected: boolean;
  onSelect: () => void;
  onMove: (stageId: string) => void;
  canMove: boolean;
}) {
  const match = matchLabel(a);
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (!canMove || !e.altKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const to = neighbourStage(stages, a.stage_id, e.key === "ArrowRight" ? 1 : -1);
    if (to) {
      e.preventDefault();
      onMove(to.id);
    }
  };
  return (
    <article
      draggable={canMove}
      onDragStart={(e: DragEvent) => e.dataTransfer.setData("text/orbit-application", a.id)}
      onKeyDown={keys}
      aria-label={`${a.name}${a.score !== null ? `, score ${a.score}` : ""}`}
      className={cx("rounded-xl border bg-white p-2.5 text-sm shadow-sm dark:bg-zinc-900", selected ? "border-indigo-500 ring-1 ring-indigo-500" : "border-zinc-200 dark:border-white/10", a.knockout_failed && "opacity-80")}
    >
      <div className="flex items-start gap-2">
        {canMove && <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${a.name}`} className={cx("mt-0.5 h-4 w-4 shrink-0", focusRing)} />}
        <div className="min-w-0 flex-1">
          <Link to={applicationPath(cid, a.id)} className={cx("block truncate rounded font-medium hover:underline", focusRing)}>
            {a.name}
          </Link>
          {a.headline && <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{a.headline}</p>}
        </div>
        <ScoreBadge a={a} />
      </div>
      {match && <p className="mt-1.5 text-xs text-zinc-700 dark:text-zinc-300">{match}</p>}
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        <Flags a={a} />
      </div>
      {a.tags.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Tags">
          {a.tags.map((t) => (
            <li key={t}>
              <Badge>{t}</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
        {relTime(a.applied_at)}
        {a.via_orbit ? " · via Orbit" : ""}
      </p>
    </article>
  );
}

function Board({ data, cid, selected, setSelected, onMove, sort, canMove }: { data: BizApplicationList; cid: string; selected: string[]; setSelected: (s: string[]) => void; onMove: (ids: string[], stageId: string) => void; sort: SortKey; canMove: boolean }) {
  const columns = groupByStage(data.job.stages, data.items, sort);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      <p className="sr-only">Tip: on a card, Alt and the left or right arrow moves it to the stage before or after.</p>
      <ol className="flex min-w-max gap-3" aria-label="Stages">
        {columns.map(({ stage, items }) => (
          <li
            key={stage.id}
            onDragOver={(e) => {
              if (!canMove) return;
              e.preventDefault();
              setOver(stage.id);
            }}
            onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/orbit-application");
              if (id && stage.kind !== "rejected") onMove(selected.includes(id) ? selected : [id], stage.id);
              else if (id) toast({ message: "Use Reject to reject applicants, so you can choose whether to email them.", tone: "info" });
            }}
            className={cx("flex w-72 shrink-0 flex-col rounded-2xl border bg-zinc-50 p-2 dark:bg-white/[0.02]", over === stage.id ? "border-indigo-400" : "border-zinc-200 dark:border-white/10")}
          >
            <h3 className="flex items-center justify-between px-1.5 pb-2 pt-1 text-sm font-semibold">
              {stage.name}
              <span className="rounded-full bg-zinc-200 px-2 text-xs tabular-nums dark:bg-white/10">{items.length}</span>
            </h3>
            <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto">
              {items.map((a) => (
                <li key={a.id}>
                  <Card a={a} cid={cid} stages={data.job.stages} selected={selected.includes(a.id)} onSelect={() => setSelected(toggleId(selected, a.id))} onMove={(to) => onMove([a.id], to)} canMove={canMove && a.status !== "withdrawn"} />
                </li>
              ))}
              {items.length === 0 && <li className="px-1.5 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">No one here</li>}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ListView({ data, cid, selected, setSelected, onMove, sort, canMove }: { data: BizApplicationList; cid: string; selected: string[]; setSelected: (s: string[]) => void; onMove: (ids: string[], stageId: string) => void; sort: SortKey; canMove: boolean }) {
  const rows = sortApplications(data.items, sort);
  const all = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const stageName = (id: string) => data.job.stages.find((s) => s.id === id)?.name ?? id;
  return (
    <Table label="Applicants" dense stack stickyHeader>
      <THead>
        <tr>
          {canMove && (
            <Th className="w-8">
              <input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSelected(all ? [] : rows.map((r) => r.id))} className={cx("h-4 w-4", focusRing)} />
            </Th>
          )}
          <Th>Applicant</Th>
          <Th>Stage</Th>
          <Th>Score</Th>
          <Th>Match</Th>
          <Th>Flags</Th>
          <Th>Source</Th>
          <Th>Applied</Th>
        </tr>
      </THead>
      <tbody>
        {rows.map((a) => (
          <Tr key={a.id} selected={selected.includes(a.id)}>
            {canMove && (
              <Td>
                <input type="checkbox" disabled={a.status === "withdrawn"} aria-label={`Select ${a.name}`} checked={selected.includes(a.id)} onChange={() => setSelected(toggleId(selected, a.id))} className={cx("h-4 w-4", focusRing)} />
              </Td>
            )}
            <Td primary>
              <Link to={applicationPath(cid, a.id)} className={cx("rounded hover:underline", focusRing)}>
                {a.name}
              </Link>
              {a.headline && <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">{a.headline}</span>}
              {a.tags.length > 0 && <span className="block text-xs font-normal text-zinc-500">{a.tags.join(", ")}</span>}
            </Td>
            <Td label="Stage">
              {canMove && !["rejected", "withdrawn"].includes(a.status) ? (
                <Select aria-label={`Stage for ${a.name}`} className="!w-auto !py-1" value={a.stage_id} onChange={(e) => onMove([a.id], e.target.value)}>
                  {data.job.stages
                    .filter((s) => s.kind !== "rejected")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              ) : (
                a.status === "withdrawn" ? "Withdrawn" : stageName(a.stage_id)
              )}
            </Td>
            <Td label="Score">
              <ScoreBadge a={a} />
            </Td>
            <Td label="Match">{matchLabel(a) ?? ""}</Td>
            <Td label="Flags">
              <div className="flex flex-col">
                <Flags a={a} />
              </div>
            </Td>
            <Td label="Source">{a.via_orbit ? "Orbit" : a.source}</Td>
            <Td label="Applied">{relTime(a.applied_at)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export function RejectDialog({ open, onClose, count, onReject }: { open: boolean; onClose: () => void; count: number; onReject: (sendEmail: boolean, subject?: string, body?: string) => Promise<void> }) {
  const id = useId();
  const [send, setSend] = useState(true);
  const [custom, setCustom] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={`Reject ${count === 1 ? "this applicant" : `${count} applicants`}?`} size="md">
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">They move to Rejected. You can undo it from their page. Their data is deleted after your retention period.</p>
        <Checkbox label="Email them" description="Your rejection template, from Orbit, with replies to you." checked={send} onChange={(e) => setSend(e.target.checked)} />
        {send && <Checkbox label="Write a different message for this send" checked={custom} onChange={(e) => setCustom(e.target.checked)} />}
        {send && custom && (
          <>
            <Field label="Subject" htmlFor={`${id}-s`}>
              <Input id={`${id}-s`} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" htmlFor={`${id}-b`} hint="You can use {{candidate_name}}, {{job_title}} and {{company_name}}.">
              <Textarea id={`${id}-b`} rows={6} value={text} maxLength={5000} onChange={(e) => setText(e.target.value)} />
            </Field>
          </>
        )}
        <DialogActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onReject(send, send && custom && subject.trim() ? subject.trim() : undefined, send && custom && text.trim() ? text.trim() : undefined);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Reject
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}

export function Pipeline() {
  const { company } = useCompany();
  const { jid = "" } = useParams();
  const id = useId();
  const [data, setData] = useState<BizApplicationList | null>(null);
  const [stats, setStats] = useState<BizJobAnalytics | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // The board's columns don't fit a phone (one shows, the rest are off to the side): a phone starts on the list
  // until the person picks a view, which is then remembered.
  const [view, setView] = useState<View>(() => {
    const saved = safeLocal.getItem(VIEW_KEY);
    if (saved === "list" || saved === "board") return saved;
    return typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches ? "list" : "board";
  });
  const [sort, setSort] = useState<SortKey>("score");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [reveal, setReveal] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStage, setBulkStage] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      biz
        .applications(company.id, jid, { q: q.trim() || undefined, tag: tag || undefined, sort, reveal })
        .then((d) => live && (setData(d), setError(null)))
        .catch((e: unknown) => live && setError(e instanceof Error ? e : new Error(String(e))));
    }, q ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [company.id, jid, q, tag, sort, reveal, n]);
  useEffect(() => {
    let live = true;
    setStats(null); setSelected([]);
    biz.jobAnalytics(company.id, jid).then((s) => { if (live) setStats(s); }).catch(() => undefined);
    return () => { live = false; };
  }, [company.id, jid, n]);
  const pickView = (v: View) => { setView(v); safeLocal.setItem(VIEW_KEY, v); };

  const canMove = company.permissions.move_applicants && company.status === "active";
  const tags = useMemo(() => [...new Set((data?.items ?? []).flatMap((a) => a.tags))].sort(), [data]);

  const move = useCallback(
    async (ids: string[], stageId: string) => {
      if (!data || ids.length === 0) return;
      const before = data;
      setData({ ...data, items: applyMove(data.items, ids, stageId) });
      try {
        await biz.move(company.id, { ids, stage_id: stageId });
        const name = data.job.stages.find((s) => s.id === stageId)?.name ?? "the stage";
        toast({ message: `Moved ${ids.length === 1 ? "1 applicant" : `${ids.length} applicants`} to ${name}`, tone: "success" });
      } catch (e) {
        setData(before);
        toast({ message: errorText(e), tone: "error" });
      }
    },
    [company.id, data],
  );

  const reject = async (ids: string[], sendEmail: boolean, subject?: string, body?: string) => {
    try {
      const r = await biz.reject(company.id, { ids, send_email: sendEmail, ...(subject ? { subject } : {}), ...(body ? { body } : {}) });
      toast({ message: rejectedMessage(r.moved, sendEmail, r.emails_waiting), tone: "success" });
      setSelected([]);
      reload();
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
      throw e;
    }
  };

  const exportCsv = async () => {
    try {
      downloadBlob(await biz.exportCsv(company.id, jid), `applicants-${data?.job.title.replace(/[^\w-]+/g, "-").toLowerCase() ?? jid}.csv`);
    } catch (e) {
      toast({ message: errorText(e), tone: "error" });
    }
  };

  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data || data.job.id !== jid) return <Loading />;
  const rejectedStage = data.job.stages.find((s) => s.kind === "rejected");
  const visible: BizApplicationList = { ...data,
    items: data.items.filter((a) => (showRejected || a.status !== "rejected") && (showWithdrawn || a.status !== "withdrawn")),
    job: { ...data.job, stages: data.job.stages.filter((s) => showRejected || s.kind !== "rejected") } };
  const rejectedCount = data.items.filter((a) => a.status === "rejected").length;

  return (
    <div className="space-y-4">
      <PageTitle
        title={data.job.title}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <JobStatusBadge status={data.job.status} /> {data.items.length} {data.items.length === 1 ? "applicant" : "applicants"}
            {stats && stats.applicants > 0 && firstReply(stats.median_first_response_hours)}
          </span>
        }
        actions={
          <>
            <Link to={planPath(company.id, jid)} className={buttonClass("secondary")}>Interview plan</Link>
            {company.permissions.move_applicants && <Link to={`/business/app/${company.id}/experience?job=${encodeURIComponent(jid)}`} className={buttonClass("secondary")}>Candidate experience</Link>}
            <Link to={jobPath(company.id, jid, "edit")} className={buttonClass("secondary")}>
              <PenLine className="h-4 w-4" aria-hidden /> {company.permissions.manage_jobs ? "Edit job" : "Job details"}
            </Link>
            {company.permissions.delete_applicants && (
              <Button variant="secondary" onClick={() => void exportCsv()}>
                <Download className="h-4 w-4" aria-hidden /> Export CSV
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="View"
          size="sm"
          value={view}
          onChange={pickView}
          options={[
            { value: "board", label: <span className="inline-flex items-center gap-1"><ChartColumn className="h-3.5 w-3.5" aria-hidden /> Board</span> },
            { value: "list", label: <span className="inline-flex items-center gap-1"><List className="h-3.5 w-3.5" aria-hidden /> List</span> },
          ]}
        />
        <div className="w-56">
          <SearchInput aria-label="Search applicants" placeholder="Search name, skill…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label htmlFor={`${id}-sort`} className="sr-only">
          Sort
        </label>
        <Select id={`${id}-sort`} className="!w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="score">Best match first</option>
          <option value="applied">Newest first</option>
          <option value="name">By name</option>
        </Select>
        {tags.length > 0 && (
          <>
            <label htmlFor={`${id}-tag`} className="sr-only">
              Tag
            </label>
            <Select id={`${id}-tag`} className="!w-auto" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">Any tag</option>
              {tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </>
        )}
        {rejectedStage && (
          <Checkbox label={`Show rejected (${rejectedCount})`} checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
        )}
        <Checkbox label={`Show withdrawn (${data.items.filter((a) => a.status === "withdrawn").length})`} checked={showWithdrawn} onChange={(e) => { setShowWithdrawn(e.target.checked); setSelected([]); }} />
        {data.blind && (company.role === "owner" || company.role === "admin" || company.role === "recruiter") && (
          <Button variant="ghost" size="sm" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
            {reveal ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />} {reveal ? "Hide names (blind review)" : "Show names"}
          </Button>
        )}
      </div>
      {data.blind && !reveal && <p className="text-xs text-zinc-600 dark:text-zinc-400">Blind review is on: names, photos and contact details are hidden.</p>}

      {canMove && selected.length > 0 && (
        <div role="region" aria-label="Selected applicants" className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm dark:border-indigo-400/30 dark:bg-indigo-400/10">
          <strong>{selected.length} selected</strong>
          {selected.length >= 2 && selected.length <= 4 && <Link to={`${jobPath(company.id, jid, "compare")}?${new URLSearchParams(selected.map((id) => ["ids", id]))}`} className={buttonClass("secondary", "sm")}>Compare evidence</Link>}
          <label htmlFor={`${id}-bulk`} className="sr-only">
            Move to stage
          </label>
          <Select id={`${id}-bulk`} className="!w-auto !py-1" value={bulkStage} onChange={(e) => setBulkStage(e.target.value)}>
            <option value="">Move to…</option>
            {data.job.stages
              .filter((s) => s.kind !== "rejected")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
          <Button
            size="sm"
            disabled={!bulkStage}
            onClick={() => {
              void move(selected, bulkStage);
              setSelected([]);
              setBulkStage("");
            }}
          >
            Move
          </Button>
          <Button size="sm" variant="danger" onClick={() => setRejecting(true)}>
            Reject…
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      {data.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No applicants yet"
          body={data.job.status === "open" ? "Share your careers page, or put the jobs widget on your own site (Settings)." : "Publish the job to start taking applications."}
          action={data.job.status === "open" ? <span className="flex flex-wrap justify-center gap-2">
            <Link to={careersPath(company.slug)} className={buttonClass("secondary", "sm")}>Open careers page</Link>
            <Button size="sm" variant="ghost" onClick={() => {
              const link = `${window.location.origin}${careersPath(company.slug)}`;
              void navigator.clipboard?.writeText(link).then(() => toast({ message: "Careers page link copied", tone: "success" }),
                () => toast({ message: link, tone: "info" }));
            }}>Copy link</Button>
          </span> : undefined}
        />
      ) : view === "board" ? (
        <Board data={visible} cid={company.id} selected={selected} setSelected={setSelected} onMove={(ids, to) => void move(ids, to)} sort={sort} canMove={canMove} />
      ) : (
        <ListView data={visible} cid={company.id} selected={selected} setSelected={setSelected} onMove={(ids, to) => void move(ids, to)} sort={sort} canMove={canMove} />
      )}

      {stats && stats.applicants > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Where this job's applicants come from">
            <SourceTable bySource={stats.by_source} total={stats.applicants} />
          </Panel>
          <Panel title="How far they get">
            <ol className="space-y-1 text-sm">
              {stats.funnel.map((f) => (
                <li key={f.stage_id} className="flex justify-between gap-2 tabular-nums">
                  <span>{f.name}</span>
                  <span>
                    {f.reached} ({Math.round(f.rate * 100)}%)
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      )}
      {!canMove && company.role === "interviewer" && <Callout tone="info">As an interviewer you see the applicants assigned to you, and can add notes and scorecards.</Callout>}
      <RejectDialog open={rejecting} onClose={() => setRejecting(false)} count={selected.length} onReject={(send, s, b) => reject(selected, send, s, b)} />
    </div>
  );
}
