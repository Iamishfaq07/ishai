import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { JobLinkInfo } from "@orbit/types";
import { ApiError, Link2 } from "@orbit/ui";
import { Button, Input, Textarea } from "../../components/ui";
import { trackAction } from "../../lib/activity";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { missionPath } from "../jobs/paths";

/**
 * Today: a job found anywhere (LinkedIn, Naukri, a company's site) in one paste. The link is read, the job is saved
 * to the tracker, and its page opens on the fit check, the next step. When the address doesn't say the company or
 * title, they're asked for right here; a link already tracked opens that job instead of adding it twice.
 */
export function QuickAddJob() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [read, setRead] = useState<JobLinkInfo | null>(null);
  // "post": the job's text pasted instead of a link (a WhatsApp forward, a PDF, a post without an address): saved
  // with the job, and the AI fit check runs on it before the job opens.
  const [mode, setMode] = useState<"link" | "post">("link");
  const [post, setPost] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (id: string, fit: boolean) => navigate(fit ? `${missionPath(id)}?tab=fit` : missionPath(id));

  const save = async (link: string, names?: { company: string; title: string }) => {
    try {
      const entry = await api.trackManualJob({ url: link, ...(names ?? {}) });
      trackAction("Added a job from a link", entry.company);
      open(entry.id, true);
    } catch (err) {
      const id = err instanceof ApiError && err.code === "already_tracked" ? String(err.details.id ?? "") : "";
      if (id) open(id, false);
      else throw err;
    }
  };

  const savePost = async () => {
    if (!company.trim() || !title.trim()) throw new Error("Add the company and the job title.");
    if (post.trim().length < 40) throw new Error("Paste the whole job post: the fit check compares it with your resume.");
    let id: string;
    try {
      id = (await api.trackManualJob({ company: company.trim(), title: title.trim() })).id;
      trackAction("Added a job from its post", company.trim());
    } catch (err) {
      const dup = err instanceof ApiError && err.code === "already_tracked" ? String(err.details.id ?? "") : "";
      if (!dup) throw err;
      id = dup;
    }
    // The fit check keeps the post on the job; if it can't run now (no resume yet, email not verified), the job is
    // saved anyway and its page says what's missing.
    await api.call(`/v1/jobs/tracker/${encodeURIComponent(id)}/fit`, { method: "POST", body: JSON.stringify({ job_text: post.trim() }) })
      .catch(() => undefined);
    open(id, true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "post") {
        await savePost();
        return;
      }
      if (read) {
        if (!company.trim() || !title.trim()) throw new Error("Add the company and the job title.");
        await save(read.url, { company: company.trim(), title: title.trim() });
        return;
      }
      const info = await api.jobLinkInfo(url.trim());
      if (info.tracked) {
        open(info.tracked.id, false);
        return;
      }
      if (info.listing_id || (info.company && info.title)) {
        await save(info.url);
        return;
      }
      // The address doesn't say: ask for what's missing here, with what it did say filled in.
      setRead(info);
      setCompany(info.company);
      setTitle(info.title);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="quick-add" className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200 sm:p-6 dark:bg-zinc-900 dark:ring-white/10">
      <h2 id="quick-add" className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-zinc-500" aria-hidden />Found a job somewhere else?</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Paste its link or its post. Orbit saves it to your applications and opens its fit check.</p>
      <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-2">
        {mode === "post" ? (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm font-medium">Company
                <Input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" className="mt-1" />
              </label>
              <label className="text-sm font-medium">Job title
                <Input value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" className="mt-1" />
              </label>
            </div>
            <label className="block text-sm font-medium">Job post
              <Textarea value={post} onChange={(e) => setPost(e.target.value)} rows={5} className="mt-1"
                        placeholder="Paste the whole post: responsibilities, requirements, location…" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy} disabled={!company.trim() || !title.trim() || post.trim().length < 40}>Save and check fit with AI</Button>
              <Button type="button" variant="ghost" onClick={() => { setMode("link"); setError(null); }}>Paste a link instead</Button>
            </div>
          </div>
        ) : !read ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="quick-add-url" className="sr-only">Job link</label>
            <Input id="quick-add-url" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)}
                   placeholder="https://www.linkedin.com/jobs/view/…" autoComplete="off" className="min-w-0 flex-1" />
            <Button type="submit" loading={busy} disabled={!url.trim()}>Save and check fit</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">From {read.site}. Add what the link doesn't say:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm font-medium">Company
                <Input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" className="mt-1" />
              </label>
              <label className="text-sm font-medium">Job title
                <Input value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" className="mt-1" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy} disabled={!company.trim() || !title.trim()}>Save and check fit</Button>
              <Button type="button" variant="ghost" onClick={() => { setRead(null); setError(null); }}>Use another link</Button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        {mode === "link" && !read && (
          <button type="button" onClick={() => { setMode("post"); setError(null); }}
                  className="min-h-6 text-sm font-medium text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-300">
            No link? Paste the job post instead
          </button>
        )}
      </form>
    </section>
  );
}
