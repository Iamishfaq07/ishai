import { useState } from "react";
import { Button, Card, ErrorNote, Select } from "../../components/ui";
import { WorkspaceSync } from "../../components/WorkspaceSync";
import { api, API_URL } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { useCareerWorkspace } from "../../lib/useCareerWorkspace";
import { downloadText } from "../../lib/prepPack";
import { EMPTY_PROJECTS, PROJECTS, projectExcerpt, validProjects, type ProjectWork } from "./projects";

interface Share { id: string; title: string; expires_at: string }
const BLANK: ProjectWork = { initial: "", revision: "", reflection: "", checks: [] };
const inputClass = "mt-2 min-h-32 w-full rounded-lg border border-zinc-300 bg-transparent p-3 text-sm dark:border-white/20";
export function Projects() {
  const sync = useCareerWorkspace("projects", EMPTY_PROJECTS, validProjects, "orbit.projects.legacy");
  const [selected, setSelected] = useState<string>(PROJECTS[0].id);
  const project = PROJECTS.find((p) => p.id === selected)!;
  const work = sync.value.work[selected] ?? BLANK;
  const [sharing, setSharing] = useState(false);
  const [review, setReview] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const shares = useAsync(() => api.call<Share[]>("/v1/career/evidence-shares"), [], "career-evidence-shares");
  const excerpt = projectExcerpt(project.title, work);
  const change = (patch: Partial<ProjectWork>) => { setReview(false); sync.change({ work: { ...sync.value.work, [selected]: { ...work, ...patch } } }); };
  const createShare = async () => {
    setSharing(true); setError("");
    try {
      const result = await api.call<{ path: string }>("/v1/career/evidence-shares", { method: "POST", body: JSON.stringify({ title: project.title, content: excerpt, days: 7 }) });
      setLink(`${API_URL}${result.path}`); setReview(false); shares.reload();
    } catch { setError("Could not create the link. Your project work is unchanged."); }
    finally { setSharing(false); }
  };
  const revoke = async (id: string) => {
    setSharing(true); setError("");
    try { await api.call(`/v1/career/evidence-shares/${id}`, { method: "DELETE" }); setLink(""); shares.reload(); }
    catch { setError("Could not revoke that link. Try again."); }
    finally { setSharing(false); }
  };
  return <section aria-labelledby="practical-projects" className="mt-8 space-y-4">
    <h2 id="practical-projects" className="font-display text-xl font-semibold">Practical projects</h2>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">Build something, adapt to a changed requirement and explain your contribution. These are practice exercises; self-checks do not certify skills. Run code in your own environment and record the actual results.</p>
    <WorkspaceSync {...sync} />
    <fieldset disabled={!sync.loaded || sync.saving || sync.conflict || sharing} className="min-w-0 space-y-4">
      <Select aria-label="Project role" value={selected} onChange={(e) => { setSelected(e.target.value); setReview(false); setLink(""); }}>{PROJECTS.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>
      <Card className="space-y-4">
        <p>{project.task}</p>
        <label className="block text-sm font-medium">Initial work and test results<textarea className={inputClass} value={work.initial} maxLength={5000} onChange={(e) => change({ initial: e.target.value })} /></label>
        <p className="text-sm"><strong>Changed requirement:</strong> {project.constraint}</p>
        <label className="block text-sm font-medium">Your revised solution<textarea className={inputClass} value={work.revision} maxLength={5000} onChange={(e) => change({ revision: e.target.value })} /></label>
        <label className="block text-sm font-medium">What changed, what you learned, and reviewer feedback<textarea className={inputClass} value={work.reflection} maxLength={3000} onChange={(e) => change({ reflection: e.target.value })} /></label>
        <fieldset><legend className="text-sm font-medium">Your self-review</legend>{project.rubric.map((criterion) => <label key={criterion} className="my-2 flex gap-2 text-sm"><input type="checkbox" checked={work.checks.includes(criterion)} onChange={(e) => change({ checks: e.target.checked ? [...work.checks, criterion] : work.checks.filter((x) => x !== criterion) })} />{criterion}</label>)}</fieldset>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => downloadText("orbit-project.txt", excerpt, "text/plain")}>Download my work</Button>
          <Button variant="secondary" disabled={!work.initial.trim() || !work.revision.trim()} onClick={() => setReview(true)}>Review excerpt to share</Button></div>
      </Card>
    </fieldset>
    {review && <Card className="space-y-3"><h3 className="font-semibold">This exact excerpt will be shared</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{excerpt}</pre>
      <p className="text-sm">Anyone with the link can read and copy this excerpt for 7 days. Remove personal or confidential data first. Revocation stops future access but cannot remove copies. Private resumes and practice sessions are not included.</p>
      <Button disabled={sharing} onClick={() => void createShare()}>Create 7-day reviewer link</Button></Card>}
    {link && <p className="break-all text-sm">Copy this link now; it is only shown once: <a className="underline" href={link} target="_blank" rel="noreferrer">{link}</a></p>}
    {error && <ErrorNote>{error}</ErrorNote>}
    {shares.error && <ErrorNote onRetry={shares.reload}>Could not load your shared excerpts.</ErrorNote>}
    {!!shares.data?.length && <Card><h3 className="font-semibold">Shared excerpts</h3><ul>{shares.data.map((s) => <li key={s.id} className="my-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span>{s.title} · expires {new Date(s.expires_at).toLocaleDateString()}</span><Button variant="ghost" disabled={sharing} onClick={() => void revoke(s.id)}>Revoke link</Button></li>)}</ul></Card>}
  </section>;
}
