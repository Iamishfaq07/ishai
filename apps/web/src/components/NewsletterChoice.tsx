import { useEffect, useState } from "react";
import { Mail, X, cx, focusRing, toast } from "@orbit/ui";
import { Button, Toggle } from "./ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";

/** Orbit's weekly tips and offers email (opt-in): the account's choice, loaded once. */
function useChoice(): [boolean | null | undefined, (on: boolean, source: "settings" | "today") => Promise<void>] {
  const [choice, setChoice] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    api.newsletter().then((r) => setChoice(r.subscribed), () => setChoice(undefined));
  }, []);
  const set = async (on: boolean, source: "settings" | "today") => {
    const before = choice;
    setChoice(on);
    try {
      setChoice((await api.setNewsletter(on, source)).subscribed);
    } catch (err) {
      setChoice(before);
      toast({ message: errorText(err), tone: "error" });
    }
  };
  return [choice, set];
}

/** Settings: the on/off switch. */
export function NewsletterToggle() {
  const [choice, set] = useChoice();
  if (choice === undefined) return null;
  return (
    <Toggle
      label="Weekly tips and offers"
      description="One email a week: tools that help your interviews, new company guides, and offers when there are any. Stop any time from the email itself."
      checked={choice === true}
      onChange={(on) => void set(on, "settings")}
    />
  );
}

/**
 * Today, once: the accounts that were never asked whether they want the weekly email (everyone who signed up before
 * it existed, and sign-ins with Google). Yes or No is remembered, so it doesn't come back.
 */
export function NewsletterAsk() {
  const [choice, set] = useChoice();
  if (choice !== null) return null;
  return (
    <section aria-labelledby="newsletter-ask" className="glass-panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
        <Mail className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="newsletter-ask" className="text-sm font-semibold">Get Orbit's weekly tips and offers?</h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">One email a week: tools for your interviews, new company guides, and offers when there are any. Stop any time.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void set(true, "today")}>Yes, send them</Button>
        <button type="button" onClick={() => void set(false, "today")} aria-label="No thanks"
          className={cx("grid h-9 w-9 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/[0.04] dark:hover:bg-white/5", focusRing)}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
