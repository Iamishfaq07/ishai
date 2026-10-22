import { SpotArt } from "../../components/SpotArt";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Code2, ExternalLink, Search, Star, cx, focusRing, safeLocal } from "@orbit/ui";
import { Button, Card, Input, PageHeader } from "../../components/ui";
import { CopyBlock } from "./CopyBlock";
import { parseUsername, projectEntry, resumeScore, skillsFrom, storyPrompts, toRepo, type Repo } from "./github";

const LAST = "orbit.github-projects.user";
const PICK = 4;

/**
 * Resume Studio → GitHub projects (github.ts): public repositories by username, ranked for a resume, then project
 * lines, skills and story prompts to copy. Asked of GitHub's public API straight from the browser; nothing is saved
 * but the username.
 */
export function GitHubProjectsPage() {
  const [input, setInput] = useState(() => safeLocal.getItem(LAST) ?? "");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [showForks, setShowForks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (e: FormEvent) => {
    e.preventDefault();
    const user = parseUsername(input);
    if (!user) { setError("That doesn't look like a GitHub username or profile link."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&type=owner`, { headers: { Accept: "application/vnd.github+json" } });
      if (res.status === 404) throw new Error("No GitHub user with that name.");
      if (res.status === 403 || res.status === 429) throw new Error("GitHub is limiting requests from this network right now. Try again in a while.");
      if (!res.ok) throw new Error("GitHub didn't answer. Try again in a moment.");
      const list = ((await res.json()) as unknown[]).map(toRepo).filter((r): r is Repo => r !== null).sort((a, b) => resumeScore(b) - resumeScore(a));
      safeLocal.setItem(LAST, user);
      setRepos(list); setChosen(list.filter((r) => !r.fork).slice(0, PICK).map((r) => r.name));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't reach GitHub.");
    } finally { setBusy(false); }
  };

  const shown = (repos ?? []).filter((r) => showForks || !r.fork);
  const picked = (repos ?? []).filter((r) => chosen.includes(r.name));
  const skills = skillsFrom(picked);
  const toggle = (name: string) => setChosen((c) => c.includes(name) ? c.filter((x) => x !== name) : [...c, name]);

  return <div>
    <PageHeader art={<SpotArt kind="resume" />} eyebrow="Resume Studio" icon={Code2} title="GitHub projects"
      subtitle="Turn your public repositories into resume projects, a skills list and interview stories. Best for freshers whose code is their experience." />
    <Card>
      <form onSubmit={(e) => void load(e)} className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="GitHub username or profile link" className="flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="your-username or https://github.com/your-username" autoComplete="off" />
        <Button type="submit" loading={busy}><Search className="h-4 w-4" aria-hidden /> Read my repositories</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Your browser asks GitHub's public API for your public repositories. Private ones are never seen, and Orbit stores only the username on this device.</p>
    </Card>

    {repos && <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby="gh-repos" className="space-y-3">
        <div className="flex items-baseline justify-between gap-2"><h2 id="gh-repos" className="font-display text-lg font-semibold">Your repositories ({shown.length})</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className={focusRing} checked={showForks} onChange={(e) => setShowForks(e.target.checked)} />Show forks</label></div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Best for a resume first: described, used, live and recent. Pick three to five.</p>
        <ul className="space-y-2">{shown.map((r) => { const on = chosen.includes(r.name); return <li key={r.name}>
          <label className={cx("flex cursor-pointer gap-3 rounded-xl border p-3 text-sm motion-safe:transition-colors", on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-zinc-200 hover:border-zinc-300 dark:border-white/10")}>
            <input type="checkbox" className={cx("mt-1", focusRing)} checked={on} onChange={() => toggle(r.name)} />
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-medium">{r.name}{r.fork && <span className="rounded bg-zinc-100 px-1.5 text-xs font-normal dark:bg-white/10">fork</span>}{r.stars > 0 && <span className="inline-flex items-center gap-0.5 text-xs font-normal text-zinc-500"><Star className="h-3 w-3" aria-hidden />{r.stars}</span>}</span>
              <span className="block text-zinc-600 dark:text-zinc-400">{r.description ?? "No description on GitHub: add one there, it helps here too."}</span>
              <span className="mt-1 block text-xs text-zinc-500">{[r.language, r.pushedAt && `updated ${new Date(r.pushedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`].filter(Boolean).join(" · ")}</span></span>
            <a href={r.url} target="_blank" rel="noopener noreferrer" className={cx("shrink-0 self-start rounded p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100", focusRing)} aria-label={`Open ${r.name} on GitHub`} onClick={(e) => e.stopPropagation()}><ExternalLink className="h-4 w-4" /></a>
          </label></li>; })}</ul>
        {!shown.length && <p className="text-sm text-zinc-600 dark:text-zinc-400">No public repositories of your own yet.</p>}
      </section>

      <section aria-labelledby="gh-out" className="space-y-4">
        <h2 id="gh-out" className="font-display text-lg font-semibold">For your resume</h2>
        {!picked.length ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Pick repositories on the left.</p> : <>
          <CopyBlock label="Projects section" hint="Replace the bracket with a real result before you use it" text={picked.map((r) => { const p = projectEntry(r); return `${p.title}\n• ${p.bullet}`; }).join("\n\n")} />
          {skills.length > 0 && <CopyBlock label="Skills your code shows" hint="Add only the ones you can talk about" text={skills.map((s) => s.skill).join(", ")} />}
          <Card><h3 className="font-semibold">Tell the story in an interview</h3>
            <div className="mt-2 space-y-3">{picked.slice(0, 3).map((r) => <div key={r.name}><p className="text-sm font-medium">{r.name}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">{storyPrompts(r).map((q) => <li key={q}>{q}</li>)}</ul></div>)}</div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm"><Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" to="/documents/stories">Save as stories</Link>
              <Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" to="/bullet-builder">Sharpen a bullet</Link>
              <Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" to="/resume-ai">Open Resume Studio</Link></div>
          </Card>
        </>}
      </section>
    </div>}
  </div>;
}
