/**
 * Stick-to-bottom for a list that grows while you read it (a transcript, a chat). It follows new lines while you're at
 * the bottom (or within NEAR_BOTTOM_PX of it). Scroll up to read and it stops following and counts what arrived since
 * ("Jump to latest · 3 new"); scroll back down, or jump, and it follows again. Pure, so it's tested without a page
 * (useStickyScroll does the scrolling).
 */
export const NEAR_BOTTOM_PX = 48;

export interface StickState {
  /** Following the bottom. */
  stuck: boolean;
  /** How many lines there were when you were last at the bottom. */
  seen: number;
  /** Lines that arrived since (shown on the jump chip). */
  unseen: number;
}

export function stickStart(count = 0): StickState {
  return { stuck: true, seen: count, unseen: 0 };
}

/** You scrolled, and are now `distance` px from the bottom of a list of `count` lines. */
export function stickScrolled(s: StickState, distance: number, count: number): StickState {
  if (distance <= NEAR_BOTTOM_PX) return s.stuck && s.seen === count && s.unseen === 0 ? s : { stuck: true, seen: count, unseen: 0 };
  return s.stuck ? { ...s, stuck: false } : s;
}

/** The list now has `count` lines. */
export function stickItems(s: StickState, count: number): StickState {
  if (s.stuck) return s.seen === count && s.unseen === 0 ? s : { stuck: true, seen: count, unseen: 0 };
  const seen = Math.min(s.seen, count); // the list was cleared or trimmed
  const unseen = count - seen;
  return seen === s.seen && unseen === s.unseen ? s : { stuck: false, seen, unseen };
}

/** "Jump to latest": back to the bottom, following again. */
export function stickJump(_s: StickState, count: number): StickState {
  return { stuck: true, seen: count, unseen: 0 };
}
