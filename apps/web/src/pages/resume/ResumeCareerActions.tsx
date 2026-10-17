import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { Resume } from "@orbit/types";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { cleanPrepContext, prepParams, readPrepContext } from "../../lib/prepContext";
import { useAuth } from "../../lib/auth";
import { errorText } from "../../lib/format";
import { buttonClass, safeSession } from "@orbit/ui";

export function ResumeCareerActions({ resume }: { resume: Resume }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  let saved = readPrepContext(new URLSearchParams(location.search), user?.id);
  try { saved = readPrepContext(new URLSearchParams(location.search), user?.id, safeSession); } catch { /* Storage blocked. */ }
  const context = cleanPrepContext(resume.prep_context ?? saved);
  const grill = async () => {
    setBusy(true); setError(null);
    try {
      const session = await api.grillResume(resume.id, resume.data, context);
      navigate(`/live/${session.id}`, { state: { systemAudio: false } });
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };
  const practice = resume.prep_context?.practice_link ?? `/mock?${prepParams(context)}`;
  // A quiet workbench card: the editor's one primary action stays Download PDF.
  return <section aria-label="Defend this resume" className="glass-panel mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl p-4">
    <div className="min-w-0 flex-1 basis-72">
      <p className="text-sm font-medium">Defend this resume out loud</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">A focused drill on your current metrics, architecture claims and projects. Preparing it uses one Resume AI credit; the interview uses five minutes.</p>
      {context.role && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{context.role}{context.company ? ` · ${context.company}` : ""}{context.tech_stack.length ? ` · ${context.tech_stack.join(", ")}` : ""}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Link to={practice} className={buttonClass("ghost")}>Practice link</Link>
      {resume.prep_context?.coding_link && <Link to={resume.prep_context.coding_link} className={buttonClass("ghost")}>Open coding workspace</Link>}
      <Button variant="secondary" disabled={busy} onClick={() => void grill()}>{busy ? "Preparing your defense…" : "Grill my resume (5-minute drill)"}</Button>
    </div>
    {error && <div className="basis-full"><ErrorNote>{error}</ErrorNote></div>}
  </section>;
}
