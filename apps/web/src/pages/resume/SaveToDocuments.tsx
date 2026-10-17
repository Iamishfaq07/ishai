import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Resume } from "@orbit/types";
import { ApiError, CircleAlert, CircleCheck, Save, X, cx, focusRing, linkedDocument, rememberDocument } from "@orbit/ui";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { resumeToText } from "./model";

/**
 * "Use in Orbit": the resume as a document, so live sessions answer from it. The first click makes the document;
 * later ones update that same document (this browser remembers which), so Documents doesn't fill up with copies. When
 * it can't be saved, it says why: the document limit, an account waiting for approval, no connection.
 */
export function SaveToDocuments({ resume }: { resume: Resume }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<{ text: string; full: boolean } | null>(null);
  const [linked, setLinked] = useState(() => linkedDocument(resume.id));
  const [updated, setUpdated] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = () => {
    const text = resumeToText(resume.data);
    setError(null);
    if (text.length < 20) {
      setError({ text: "Add some of your resume first: there's nothing to use yet.", full: false });
      return;
    }
    setState("busy");
    api
      .createTextDocument({ kind: "resume", title: resume.title.trim() || "My resume", text, ...(linked ? { replace_id: linked } : {}) })
      .then((doc) => {
        setUpdated(doc.id === linked);
        rememberDocument(resume.id, doc.id);
        setLinked(doc.id);
        setState("done");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState("idle"), 4000);
      })
      .catch((err: unknown) => {
        setState("idle");
        // 402 here is the plan's document limit, not resume credits.
        setError({ text: errorText(err), full: err instanceof ApiError && err.status === 402 });
      });
  };

  return (
    <div className="relative">
      <Button
        variant="secondary"
        disabled={state === "busy"}
        title={linked ? "Update this resume's copy in Documents, so live sessions answer from the latest version" : "Add this resume to Documents, so live sessions answer from it"}
        onClick={save}
      >
        {state === "done" ? <CircleCheck className="h-4 w-4 text-emerald-600" /> : <Save className="h-4 w-4" />}
        {state === "busy" ? "Saving…" : state === "done" ? (updated ? "Updated in Documents" : "Saved to Documents") : linked ? "Update in Orbit" : "Use in Orbit"}
      </Button>
      {error && (
        <div role="alert" className="absolute left-1/2 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl bg-white p-3 text-sm text-zinc-700 shadow-popover ring-1 ring-rose-500/30 dark:bg-zinc-900 dark:text-zinc-200">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
            <p className="flex-1">
              <span className="font-medium">Couldn't save it to Documents.</span> {error.text}
              {error.full && (
                <>
                  {" "}
                  <Link to="/documents" className={cx("font-medium text-indigo-600 underline dark:text-indigo-400", focusRing)}>
                    Open Documents
                  </Link>
                </>
              )}
            </p>
            <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className={cx("rounded p-0.5 text-zinc-500", focusRing)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
