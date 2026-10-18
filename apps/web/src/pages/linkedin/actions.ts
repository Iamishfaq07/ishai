import { useCallback, useEffect, useRef, useState } from "react";
import type { LinkedInFixInput, LinkedInState, LinkedInSuggestion, LinkedInSuggestionPatch } from "@orbit/types";
import { currentMotion, toast } from "@orbit/ui";
import { api } from "../../lib/api";
import { errorText } from "../../lib/format";
import { isUpgradeError, useAllowance } from "../resume/allowance";
import { PART_SECTION } from "./model";

export interface ActionError {
  key: string;
  text: string;
  upgrade: boolean;
}

export interface LinkedInActions {
  /** What's running: "fix:headline", "fix:experience:0", "rewrite", "s:<id>". */
  busy: string | null;
  error: ActionError | null;
  /** The section a change just landed in (its bar flashes) and the suggestion just applied (its card sweeps). */
  flash: { id: string; at: number } | null;
  sweep: { id: string; at: number } | null;
  fix: (input: LinkedInFixInput) => Promise<void>;
  rewrite: (resumeId: string) => Promise<void>;
  apply: (s: LinkedInSuggestion, on: boolean) => Promise<void>;
  patch: (s: LinkedInSuggestion, patch: LinkedInSuggestionPatch) => Promise<boolean>;
  remove: (s: LinkedInSuggestion) => Promise<void>;
}

export const fixKey = (input: { part: string; role?: number | null }): string =>
  `fix:${input.part}${input.role !== undefined && input.role !== null ? `:${input.role}` : ""}`;

/** Brings a new suggestion's card into view and puts focus on its heading, so the change is seen and announced. */
function reveal(id: string): void {
  window.requestAnimationFrame(() => {
    const card = document.getElementById(`li-s-${id}`);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: currentMotion() === "full" ? "smooth" : "auto" });
    card.querySelector<HTMLElement>("[data-card-title]")?.focus({ preventScroll: true });
  });
}

/** LinkedIn AI's actions: one at a time, each answered by the whole new state, with its error kept by where it came from. */
export function useLinkedInActions(state: LinkedInState, set: (s: LinkedInState) => void): LinkedInActions {
  const { refresh } = useAllowance();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null);
  const [sweep, setSweep] = useState<{ id: string; at: number } | null>(null);
  const live = useRef(state);
  live.current = state;
  useEffect(() => {
    if (!flash && !sweep) return;
    const t = window.setTimeout(() => {
      setFlash(null);
      setSweep(null);
    }, 1800);
    return () => window.clearTimeout(t);
  }, [flash, sweep]);

  const run = useCallback(async <T,>(key: string, work: () => Promise<T>): Promise<T | null> => {
    setBusy(key);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError({ key, text: errorText(err), upgrade: isUpgradeError(err) });
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const fix = async (input: LinkedInFixInput) => {
    const out = await run(fixKey(input), () => api.linkedinFix(input));
    refresh();
    if (!out) return;
    set(out);
    reveal(out.suggestion_id);
  };

  const rewrite = async (resumeId: string) => {
    const out = await run("rewrite", () => api.linkedinRewrite(resumeId));
    refresh();
    if (!out) return;
    set(out);
    const first = out.suggestions?.[0];
    if (first) reveal(first.id);
    toast({ message: "Headline, About and skills written", detail: "They're below, ready to apply and copy.", tone: "success" });
  };

  const apply = async (s: LinkedInSuggestion, on: boolean) => {
    const before = live.current.scores?.now ?? live.current.audit?.score ?? 0;
    const out = await run(`s:${s.id}`, () => api.applyLinkedInSuggestion(s.id, on));
    if (!out) return;
    set(out);
    const after = out.scores?.now ?? out.audit?.score ?? before;
    const section = PART_SECTION[s.part];
    if (section) setFlash({ id: section, at: Date.now() });
    if (on) setSweep({ id: s.id, at: Date.now() });
    toast({
      message: on ? "Applied to Orbit's copy" : "Put back as LinkedIn has it",
      detail: after !== before ? `Score ${before} → ${after}.` : "The score didn't change: this part already scored the same.",
      tone: on ? "success" : "neutral",
    });
  };

  const patch = async (s: LinkedInSuggestion, p: LinkedInSuggestionPatch): Promise<boolean> => {
    const out = await run(`s:${s.id}`, () => api.patchLinkedInSuggestion(s.id, p));
    if (out) set(out);
    return Boolean(out);
  };

  const remove = async (s: LinkedInSuggestion) => {
    const out = await run(`s:${s.id}`, () => api.deleteLinkedInSuggestion(s.id));
    if (!out) return;
    set(out);
    toast({ message: `Removed: ${s.label}` });
  };

  return { busy, error, flash, sweep, fix, rewrite, apply, patch, remove };
}
