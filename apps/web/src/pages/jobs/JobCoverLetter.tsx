import { useState } from "react";
import { Link } from "react-router-dom";
import type { CoverLetterLength, CoverLetterTone, JobMission, JobTrackerEntry } from "@orbit/types";
import { Copy, FileText, Sparkles, toast } from "@orbit/ui";
import { Button, Field, Select, Textarea } from "../../components/ui";
import { trackAction } from "../../lib/activity";
import { api } from "../../lib/api";
import { downloadText, errorText } from "../../lib/format";
import { textLink } from "./links";

const FILL = /\[[^\][\n]{1,160}\]/g; // the same placeholders Resume Studio flags

/**
 * A cover letter for this job without leaving it: written from the resume this job uses and its saved post (or the
 * role and company when there's no post yet), one resume credit, the same grounded letter Resume Studio writes. It
 * isn't saved here: copy it or download it as Word before leaving.
 */
export function JobCoverLetter({ entry, mission }: { entry: JobTrackerEntry; mission: JobMission }) {
  const [tone, setTone] = useState<CoverLetterTone>("professional");
  const [length, setLength] = useState<CoverLetterLength>("standard");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [word, setWord] = useState<"idle" | "busy" | "error">("idle");
  const fills = text.match(FILL) ?? [];
  const resume = mission.resume;

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      setText((await api.jobCoverLetter(entry.id, { tone, length })).text);
      trackAction("Wrote a cover letter for a job", entry.company);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // Word uses the resume's own name, contact line and design, the same file Resume Studio makes.
  const downloadWord = async (id: string) => {
    setWord("busy");
    try {
      const r = await api.getResume(id);
      const blob = await api.coverLetterDocx(text, r.data, r.design);
      downloadText(`Cover letter - ${entry.company}.docx`.replace(/[\\/:*?"<>|]/g, ""), blob, blob.type);
      setWord("idle");
    } catch {
      setWord("error");
    }
  };

  return (
    <section aria-labelledby="job-letter" className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200 sm:p-6 dark:bg-zinc-900 dark:ring-white/10">
      <h2 id="job-letter" className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-zinc-500" aria-hidden />A cover letter for this job</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Written from {resume ? `“${resume.title}”` : "the resume linked to this job"} and {entry.document_id ? "this job's post" : `the role at ${entry.company}`}.
        It only uses what your resume says.
      </p>
      {!resume ? (
        <p className="mt-3 text-sm">Link a resume to this job above first; the letter is written from it.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Tone" htmlFor="job-letter-tone">
              <Select id="job-letter-tone" value={tone} disabled={busy} onChange={(e) => setTone(e.target.value as CoverLetterTone)}>
                <option value="professional">Professional</option><option value="warm">Warm</option><option value="confident">Confident</option>
              </Select>
            </Field>
            <Field label="Length" htmlFor="job-letter-length">
              <Select id="job-letter-length" value={length} disabled={busy} onChange={(e) => setLength(e.target.value as CoverLetterLength)}>
                <option value="standard">Standard</option><option value="short">Short</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button loading={busy} onClick={() => void write()}><Sparkles className="h-4 w-4" aria-hidden />{text ? "Write a new one" : "Write my cover letter"}</Button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Uses 1 resume credit.</span>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">{error} {/credit|upgrade|plan/i.test(error) && <Link className={textLink} to="/billing">See plans</Link>}</p>}
          {text && (
            <div className="mt-4 space-y-3">
              <Field label="Your letter" htmlFor="job-letter-text">
                <Textarea id="job-letter-text" rows={14} maxLength={6000} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              {fills.length > 0 && <p className="text-sm text-amber-900 dark:text-amber-200">Fill in {fills.length === 1 ? "the placeholder" : `${fills.length} placeholders`} like {fills[0]} before you send it.</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(text).then(() => toast("Copied"), () => toast({ message: "Couldn't copy", tone: "error" }))}>
                  <Copy className="h-4 w-4" aria-hidden /> Copy
                </Button>
                <Button variant="secondary" disabled={word === "busy"} onClick={() => void downloadWord(resume.id)}>
                  <FileText className="h-4 w-4" aria-hidden /> {word === "busy" ? "Preparing…" : word === "error" ? "Couldn't download, try again" : "Word"}
                </Button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Not saved on this page: copy or download it before you leave.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
