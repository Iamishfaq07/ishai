import type { LinkedInState } from "@orbit/types";
import { Copy, ProgressBar, toast } from "@orbit/ui";
import { Button, Card } from "../../components/ui";
import type { LinkedInActions } from "./actions";
import { copyAll, progressText } from "./model";
import { ScoreTrail } from "./ScorePanel";
import { SuggestionCard } from "./SuggestionCard";

/**
 * The suggestions kept with the profile: how many are done on LinkedIn, the score as read against the score with
 * every fix applied, "Copy all" for the new headline, About and skills, and a card for each.
 */
export function Suggestions({ state, actions }: { state: LinkedInState; actions: LinkedInActions }) {
  const list = state.suggestions ?? [];
  const progress = state.progress ?? { done: list.filter((s) => s.done).length, total: list.length };
  const scores = state.scores;
  if (!list.length) return null;
  const copy = () => {
    const text = copyAll(state);
    if (!navigator.clipboard) return toast({ message: "Couldn't copy", tone: "error" });
    void navigator.clipboard.writeText(text).then(
      () => toast({ message: "Copied all three", detail: "Headline, About and skills, labelled: paste each into its place on LinkedIn." }),
      () => toast({ message: "Couldn't copy", detail: "The browser blocked the clipboard.", tone: "error" }),
    );
  };
  return (
    <section aria-labelledby="li-fixes-title" className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="li-fixes-title" className="font-display text-base font-semibold">Your fixes, ready to paste</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Copy each one into LinkedIn, then tick it done. Apply it to Orbit's copy to see the new score.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={copy}>
            <Copy className="h-3.5 w-3.5" /> Copy all
          </Button>
        </div>
        <ProgressBar className="mt-4" label={progressText(progress.done, progress.total) || "Nothing done yet"} value={progress.done} max={Math.max(progress.total, 1)}
                     valueText={`${progress.done} of ${progress.total}`} tone={progress.total && progress.done === progress.total ? "success" : "accent"} />
        {scores && <div className="mt-4"><ScoreTrail read={scores.read} now={scores.now} projected={scores.projected} /></div>}
      </Card>
      <div className="space-y-4">
        {list.map((s) => <SuggestionCard key={s.id} s={s} actions={actions} sweepAt={actions.sweep?.id === s.id ? actions.sweep.at : null} />)}
      </div>
    </section>
  );
}
