import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { Resume } from "@orbit/types";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { cleanPrepContext, prepParams, readPrepContext } from "../../lib/prepContext";
import { useAuth } from "../../lib/auth";
import { errorText } from "../../lib/format";
import { focusRing, safeSession } from "@orbit/ui";

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
  return <div className="mb-5 space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={busy} onClick={() => void grill()}>{busy ? "Preparing your defense…" : "Grill My Resume (5-Min Drill)"}</Button>
      <Link to={practice} className={`rounded-lg px-2 py-2 text-sm font-medium text-cyan-800 hover:underline dark:text-cyan-200 ${focusRing}`}>Practice Link</Link>
      {resume.prep_context?.coding_link && <Link to={resume.prep_context.coding_link} className={`rounded-lg px-2 py-2 text-sm font-medium text-cyan-800 dark:text-cyan-200 ${focusRing}`}>Open coding workspace</Link>}
    </div>
    <p className="text-xs text-zinc-500">A focused drill on your current metrics, architecture claims and projects. Preparing it uses one Resume AI credit; the interview uses five minutes.</p>
    {context.role && <p className="text-xs">{context.role}{context.company ? ` · ${context.company}` : ""}{context.tech_stack.length ? ` · ${context.tech_stack.join(", ")}` : ""}</p>}
    {error && <ErrorNote>{error}</ErrorNote>}
  </div>;
}
