import { useState } from "react";
import { Link } from "react-router-dom";
import type { JobTrackerEntry } from "@orbit/types";
import { CopyButton } from "@orbit/ui";
import { Card, Textarea } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { bounceLinks, feedbackRequest } from "./bounceText";
import { linkButton, textLink } from "./links";

/**
 * Bounce back, on a job recorded as "Not this time": ask for feedback (a message to copy or email, edited first), the
 * same title at other companies, and a practice round for this role. Nothing is sent by Orbit.
 */
export function BounceBack({ entry }: { entry: JobTrackerEntry }) {
  const { user } = useAuth();
  const [message, setMessage] = useState(() => feedbackRequest(entry, user?.name ?? ""));
  const links = bounceLinks(entry);
  const mail = `mailto:?${new URLSearchParams({ subject: `Feedback on my application: ${entry.title}`, body: message }).toString().replace(/\+/g, "%20")}`;
  return (
    <Card id="bounce-back">
      <h2 className="font-title text-lg font-semibold">Bounce back</h2>
      <p className="mt-1 max-w-prose text-sm text-zinc-600 dark:text-zinc-300">
        A no is still information. Ask what would have made the difference, look at the same role elsewhere, and practise
        the round that was hardest.
      </p>

      <h3 className="mt-5 text-sm font-semibold">1. Ask for feedback</h3>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Reply to the person who told you, or the recruiter. Edit it first; Orbit doesn't send anything.
      </p>
      <label className="mt-2 block">
        <span className="sr-only">Message asking for feedback</span>
        <Textarea rows={9} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyButton text={message} label="Copy message" />
        <a href={mail} className={linkButton("secondary", "sm")}>Open in my email</a>
      </div>

      <h3 className="mt-5 text-sm font-semibold">2. Keep going</h3>
      <ul className="mt-2 space-y-2 text-sm">
        <li>
          <Link to={links.similar} className={textLink}>Find {entry.title.trim() ? `${entry.title.trim()} roles` : "similar roles"} at other companies</Link>
        </li>
        <li>
          <Link to={links.practice} className={textLink}>Practise a {entry.company.trim() ? `${entry.company.trim()}-style ` : ""}interview round</Link>
          <span className="text-zinc-600 dark:text-zinc-400"> with the AI interviewer, then a scored report.</span>
        </li>
      </ul>
    </Card>
  );
}
