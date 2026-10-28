import { useEffect, useState } from "react";
import type { AccountNotices } from "@orbit/types";
import { api } from "./api";

// What the account was given (credits, a plan, an approval, a referral reward, a purchase). The header's bell and
// the card on Today share one copy, so reading a notice in one clears it in the other.

let current: AccountNotices | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(n: AccountNotices | null) => void>();

function publish(next: AccountNotices | null): void {
  current = next;
  for (const fn of listeners) fn(next);
}

export function refreshNotices(): Promise<void> {
  loading ??= Promise.resolve()
    .then(() => api.notices())
    .then(publish)
    .catch(() => undefined) // the bell stays quiet when the API can't answer; nothing else depends on it
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Marks these notices read (all of them with no ids). */
export async function readNotices(ids?: string[]): Promise<void> {
  if (!current?.unread) return;
  const ours = new Set(ids ?? current.items.map((n) => n.id));
  // At once on screen; the server's answer then replaces it.
  publish({
    items: current.items.map((n) => (ours.has(n.id) ? { ...n, read: true } : n)),
    unread: Math.max(0, current.unread - current.items.filter((n) => ours.has(n.id) && !n.read).length),
  });
  try {
    publish(await api.readNotices(ids));
  } catch {
    void refreshNotices();
  }
}

/** Calls `fn` with every new copy; returns the unsubscribe. */
export function subscribeNotices(fn: (n: AccountNotices | null) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The account's notices, fetched once per page load and again whenever the window comes back into focus. */
export function useNotices(): AccountNotices | null {
  const [state, setState] = useState(current);
  useEffect(() => {
    const unsubscribe = subscribeNotices(setState);
    if (current === null) void refreshNotices();
    const onFocus = () => void refreshNotices();
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return state;
}

/** Forgets the copy (on sign-out), so the next account doesn't see this one's. */
export function resetNotices(): void {
  publish(null);
}
