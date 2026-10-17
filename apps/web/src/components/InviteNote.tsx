import { useEffect, useState } from "react";
import type { ReferralCodeInfo } from "@orbit/types";
import { Sparkles } from "@orbit/ui";
import { api } from "../lib/api";
import { storedRef } from "../lib/referral";

/**
 * On the sign-up page, after an invite or creator link: what its code gives, as the server says (nothing when the
 * code can't be used, or referrals are off there). Only the discount is promised; the server applies it at checkout.
 */
export function InviteNote() {
  const [info, setInfo] = useState<ReferralCodeInfo | null>(null);
  useEffect(() => {
    const code = storedRef();
    if (!code) return;
    let live = true;
    api.referralCode(code).then((got) => live && setInfo(got)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!info || info.percent <= 0) return null;
  const from = info.kind === "invite" ? "A friend invited you" : `Code ${info.code}${info.label ? ` from ${info.label}` : ""}`;
  return (
    <p role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-900 dark:text-emerald-100">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {from}: <span className="font-semibold">{info.percent}% off your first purchase</span>, taken off at checkout.
      </span>
    </p>
  );
}
