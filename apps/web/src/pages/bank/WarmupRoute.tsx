import { use } from "react";
import { useSearchParams } from "react-router-dom";
import { addBankTrack } from "../../lib/warmup/bank";
import { WarmupPage } from "../Warmup";
import { parseTrack, warmupItems, type BankKind } from "./content";
import { loadCompany, loadRole } from "./docs";

const opening = new Map<string, Promise<void>>();

/** Loads a guide's questions as a warm-up track (once), so the warm-up finds it by its id. */
function openTrack(kind: BankKind, slug: string): Promise<void> {
  const id = `${kind}:${slug}` as const;
  let p = opening.get(id);
  if (!p) {
    p = (kind === "company" ? loadCompany(slug) : loadRole(slug)).then((entry) => {
      if (!entry) return;
      addBankTrack({
        id,
        name: entry.name,
        blurb: kind === "company" ? `Practice questions in the style of ${entry.name}'s interviews.` : `Practice questions for ${entry.name.toLowerCase()} interviews.`,
        questions: warmupItems(slug, entry.questions),
      });
    });
    opening.set(id, p);
  }
  return p;
}

/**
 * /warmup: the free warm-up (pages/Warmup.tsx). A guide's "Warm up free on these questions" links here with
 * `?track=company:<slug>` or `role:<slug>`; that guide's questions are loaded first and the round starts on them.
 */
export function WarmupRoute() {
  const [params] = useSearchParams();
  const linked = parseTrack(params.get("track"));
  // Every render with a linked track waits on the same (cached) promise, so React sees `use` on each one.
  if (linked) use(openTrack(linked.kind, linked.slug));
  return <WarmupPage />;
}
