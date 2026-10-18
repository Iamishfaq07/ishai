import type { SecurityEvent } from "@orbit/types";
import { safeLocal } from "@orbit/ui";

/**
 * Home's "your sign-in changed" notice (auth/alerts.py on the API): the newest serious change to how the account is
 * signed in to (a passkey added, two-step sign-in on or off, a new password) from the last fortnight, until it's
 * acknowledged on this device. The email says the same when the server can send email; this is the copy that always
 * arrives. Acknowledging keeps the time of the newest event seen, so a later change shows again.
 */
export const SECURITY_ACK_KEY = "orbit.securityAck";

export function securityNotice(items: readonly SecurityEvent[], acknowledgedAt: string | null): SecurityEvent | null {
  const ack = acknowledgedAt ? Date.parse(acknowledgedAt) : Number.NaN;
  const newest = items.find((i) => i.notice);
  if (!newest) return null;
  return Number.isNaN(ack) || Date.parse(newest.at) > ack ? newest : null;
}

/** This device made the change itself (Settings, the reset page): nothing to warn about here. Kept as "now", so
 *  anything that happens after still shows. */
export function acknowledgeSecurityChanges(now: Date = new Date()): void {
  safeLocal.setItem(SECURITY_ACK_KEY, now.toISOString());
}

export function acknowledgedAt(): string | null {
  return safeLocal.getItem(SECURITY_ACK_KEY);
}
