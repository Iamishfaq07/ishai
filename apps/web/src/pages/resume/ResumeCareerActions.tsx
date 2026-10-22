import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { Resume } from "@orbit/types";
import { Button, ErrorNote } from "../../components/ui";
import { api } from "../../lib/api";
import { cleanPrepContext, prepParams, readPrepContext } from "../../lib/prepContext";
import { useAuth } from "../../lib/auth";
import { errorText } from "../../lib/format";
import { buttonClass, safeSession } from "@orbit/ui";
import { Fold } from "../../components/Fold";

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
  // Folded under the editor: the editor's one primary action stays Download PDF. It opens by itself when the resume
  // was tailored for a role, since that's when a drill on it pays off.
  return <div className="mb-5"><Fold title="Defend this resume out loud"
    hint={context.role ? `A 5-minute drill for ${context.role}${context.company ? ` at ${context.company}` : ""}` : "A 5-minute spoken drill on your metrics, claims and projects"}
    defaultOpen={Boolean(context.role)}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-3 pb-2">
      <p className="min-w-0 flex-1 basis-72 text-[13px] text-zinc-600 dark:text-zinc-400">Preparing it uses one Resume credit; the interview uses five minutes.{context.tech_stack.length ? ` Stack: ${context.tech_stack.join(", ")}.` : ""}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={practice} className={buttonClass("ghost")}>Practice link</Link>
        {resume.prep_context?.coding_link && <Link to={resume.prep_context.coding_link} className={buttonClass("ghost")}>Open coding workspace</Link>}
        <Button variant="secondary" disabled={busy} disabledReason="Preparing your drill." onClick={() => void grill()}>{busy ? "Preparing your defense…" : "Grill my resume"}</Button>
      </div>
      {error && <div className="basis-full"><ErrorNote>{error}</ErrorNote></div>}
    </div>
  </Fold></div>;
}
