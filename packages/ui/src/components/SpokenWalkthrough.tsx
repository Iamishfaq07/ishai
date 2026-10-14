import { useId, useState, type ReactNode } from "react";
import type { LiveAnswer } from "@orbit/types";
import { cx, focusRing } from "./cx";

export function SpokenWalkthrough({ walkthrough, code, load, complete = false }: {
  walkthrough: LiveAnswer["walkthrough"]; code: ReactNode;
  load?: () => Promise<NonNullable<LiveAnswer["walkthrough"]>>; complete?: boolean;
}) {
  const [tab, setTab] = useState<"code" | "spoken">("code");
  const [generated, setGenerated] = useState<LiveAnswer["walkthrough"]>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explanation = walkthrough?.intuition && walkthrough.commentary.length === 3 && walkthrough.complexity_defense ? walkthrough : generated;
  const open = (key: "code" | "spoken") => {
    setTab(key);
    if (key !== "spoken" || explanation || !load || busy) return;
    setBusy(true); setError(null);
    void load().then(setGenerated).catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not prepare the walkthrough.")).finally(() => setBusy(false));
  };
  const id = useId();
  return <div className="mt-3 overflow-hidden rounded-xl border border-zinc-500/15">
    <div role="tablist" aria-label="Coding answer view" className="flex gap-1 border-b border-zinc-500/15 p-1">
      {(["code", "spoken"] as const).map((key) => <button key={key} id={`${id}-${key}-tab`} role="tab"
        aria-selected={tab === key} aria-controls={`${id}-${key}`} tabIndex={tab === key ? 0 : -1}
        onKeyDown={(e) => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); open(key === "code" ? "spoken" : "code"); document.getElementById(`${id}-${key === "code" ? "spoken" : "code"}-tab`)?.focus(); } }}
        onClick={() => open(key)} className={cx("rounded-lg px-3 py-2 text-xs font-medium", tab === key ? "bg-cyan-500/10 text-cyan-800 dark:text-cyan-200" : "text-zinc-500", focusRing)}>
        {key === "code" ? "Code" : "30s Spoken Walkthrough"}
      </button>)}
    </div>
    <div id={`${id}-code`} role="tabpanel" aria-labelledby={`${id}-code-tab`} hidden={tab !== "code"}>{code}</div>
    <div id={`${id}-spoken`} role="tabpanel" aria-labelledby={`${id}-spoken-tab`} hidden={tab !== "spoken"} className="space-y-4 p-4 text-sm leading-relaxed">
      {explanation ? <>
        <div><h4 className="telemetry mb-1 text-xs uppercase text-cyan-700 dark:text-cyan-300">Before typing</h4><p>{explanation.intuition}</p></div>
        <div><h4 className="telemetry mb-1 text-xs uppercase text-cyan-700 dark:text-cyan-300">While writing</h4><ol className="list-decimal space-y-2 pl-5">{explanation.commentary.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
        <div><h4 className="telemetry mb-1 text-xs uppercase text-cyan-700 dark:text-cyan-300">Complexity defense</h4><p>{explanation.complexity_defense}</p></div>
      </> : error ? <div role="alert">{error}<button onClick={() => open("spoken")} className={cx("ml-2 underline", focusRing)}>Retry</button></div>
        : <p role="status" className="text-zinc-500">{busy ? "Preparing a walkthrough of this solution…" : complete ? "This saved answer has no spoken walkthrough." : "The spoken walkthrough appears as Orbit finishes this coding answer."}</p>}
    </div>
  </div>;
}
