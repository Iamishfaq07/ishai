import { useState, type FormEvent } from "react";
import type { ReferralInvite, ReferralOffer } from "@orbit/types";
import { CopyButton, MessageCircle, Send, Sparkles, Users, buttonClass, cx, focusRing, toast } from "@orbit/ui";
import { Button, Card, ErrorNote, Input } from "./ui";
import { api } from "../lib/api";
import { errorText } from "../lib/format";
import { normalizeCode } from "../lib/referral";

/**
 * Plan & billing's referral pieces (ORBIT_REFERRALS; the server's billing/referrals.py decides everything): the
 * account's first-purchase discount, or a box to enter a creator's, campus's or friend's code before the first
 * purchase; and Invite friends, the account's own link with what a friend gets and what they've earned.
 */

/** "10% off your first purchase (code PRIYA10): the prices below include it", or "Have a code?". */
export function CodeEntry({ offer, canEnter, prefill, onApplied }: {
  offer: ReferralOffer | null;
  /** No payment yet: codes are for a first purchase. */
  canEnter: boolean;
  /** A code from a link the account followed while signed in. */
  prefill?: string | null;
  onApplied: (offer: ReferralOffer) => void;
}) {
  const [open, setOpen] = useState(Boolean(prefill));
  const [code, setCode] = useState(prefill ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (offer && offer.percent > 0) {
    const who = offer.kind === "invite" ? "from a friend's invite" : `with code ${offer.code}${offer.label ? ` (${offer.label})` : ""}`;
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{offer.percent}% off your first purchase</span>, {who}. The prices below include it.
        </span>
      </p>
    );
  }
  if (!canEnter) return null;

  const apply = async (e: FormEvent) => {
    e.preventDefault();
    const typed = normalizeCode(code);
    if (!typed) {
      setError("Codes are 3 to 32 letters or digits.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const got = await api.redeemCode(typed);
      toast(got.percent ? `Code ${got.code} saved: ${got.text}.` : `Code ${got.code} saved.`);
      onApplied(got);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className={cx("text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
        Have a code?
      </button>
    );
  }
  return (
    <form onSubmit={(e) => void apply(e)} className="space-y-2">
      <label htmlFor="referral-code" className="block text-sm font-medium">Code from a friend, a creator or your campus</label>
      <div className="flex max-w-md gap-2">
        <Input id="referral-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
               autoCapitalize="characters" spellCheck={false} maxLength={40} placeholder="e.g. PRIYA10" />
        <Button type="submit" loading={busy} disabled={!code.trim()}>Apply</Button>
      </div>
      <p className="text-xs text-zinc-500">It comes off your first purchase. One code per account.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
    </form>
  );
}

/** Invite friends: the link, Copy / Share / WhatsApp, and how it's gone so far. */
export function InviteFriends({ invite }: { invite: ReferralInvite }) {
  const share = async () => {
    try {
      await navigator.share({ title: "Orbit AI", text: invite.share_text });
    } catch {
      /* Closed the share sheet: nothing to do. */
    }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const stats: Array<[string, number]> = [
    ["Joined", invite.joined],
    ["Paid", invite.paid],
    ["Minutes earned", invite.minutes_earned],
  ];
  return (
    <Card>
      <h2 className="flex items-center gap-2 font-semibold">
        <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden="true" /> Invite friends
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {invite.discount_percent > 0 ? `Friends who sign up with your link get ${invite.discount_percent}% off their first purchase. ` : ""}
        You get {invite.reward_minutes} interview minutes when each one makes their first payment (up to {invite.monthly_cap} friends
        a month). Minutes from a payment that's refunded are taken back if you haven't used them.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={invite.link} aria-label="Your invite link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs sm:text-sm" />
        <div className="flex shrink-0 gap-2">
          <CopyButton
            size="md"
            text={invite.link}
            copiedLabel="Link copied"
            onFailed={() => toast({ message: "Couldn't copy. Select the link and copy it.", tone: "error" })}
          />
          {canShare && (
            <Button variant="secondary" onClick={() => void share()}>
              <Send className="h-4 w-4" aria-hidden="true" /> Share
            </Button>
          )}
          <a href={`https://wa.me/?text=${encodeURIComponent(invite.share_text)}`} target="_blank" rel="noopener noreferrer"
             className={buttonClass("secondary")}>
            <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
          </a>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-zinc-500/[0.06] px-3 py-2.5 dark:bg-white/[0.04]">
            <dt className="text-xs text-zinc-500">{label}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{value.toLocaleString("en-IN")}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
