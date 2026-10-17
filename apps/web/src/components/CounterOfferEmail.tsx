import { useState } from "react";
import { Check, Copy, Mail } from "@orbit/ui";
import { Button, Card } from "./ui";

/**
 * After salary practice: the counter-offer email to send the recruiter, written from what was offered and what the
 * candidate said on the call. Edit it here, then copy it out; nothing is sent from Orbit.
 */
export function CounterOfferEmail({ email }: { email: { subject: string; body: string } }) {
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <Card>
      <h2 className="flex items-center gap-2 font-display font-semibold">
        <Mail className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden /> Your counter-offer email
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Put your counter in writing after the call. It uses only the numbers from the offer, your target and what you
        said. Check them, add your name, and send it from your own email.
      </p>
      <label className="mt-3 block text-xs font-medium text-zinc-500" htmlFor="counter-subject">Subject</label>
      <input id="counter-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150}
        className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-white/10" />
      <label className="mt-3 block text-xs font-medium text-zinc-500" htmlFor="counter-body">Email</label>
      <textarea id="counter-body" value={body} onChange={(e) => setBody(e.target.value)} rows={9}
        className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm leading-relaxed dark:border-white/10" />
      <div className="mt-2">
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy email"}
        </Button>
      </div>
    </Card>
  );
}
