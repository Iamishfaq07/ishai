import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { draftGeneration, readCandidateDraft, writeCandidateDraft } from "./candidateDrafts";

/** Restore input only. Review proposals, consent and approvals must always be obtained again. */
export function useCandidateDraft(kind: string, opportunity: string): [string, (value: string) => void] {
  const { user } = useAuth();
  const key = `${user?.id ?? "signed-out"}:${opportunity}:${kind}`;
  const generation = draftGeneration();
  const [state, setState] = useState(() => ({ key, value: readCandidateDraft(key) }));
  const value = state.key === key ? state.value : "";
  useEffect(() => {
    if (!value) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [value]);
  return [value, (next: string) => {
    if (!user || generation !== draftGeneration()) return;
    writeCandidateDraft(key, next, generation); setState({ key, value: next });
  }];
}
