/**
 * At most TWO scale pops stack on one element (owner 2026-11-08, R-BADGE-POP-STACK-01).
 *
 * Two independent paths pop a stat badge, both additively (`composite: 'add'`, so their scales MULTIPLY):
 * `Card.tsx`'s number-change pop and an authored `react` layer (the Ruby gem's `ruby-gem-apply` pops `.badge`).
 * A burst of Rubies in combat started a new pop of each kind on every gem before the last one finished, and
 * 1.35 × 1.35 × 1.35 … grew the medallions to several times their size.
 *
 * Every pop still plays — the newest always starts. When a third one starts on the same element, the OLDEST
 * live pop is cancelled, so the element never carries more than `MAX_STACKED_POPS` scales at once.
 */

/** How many pops may be live on one element at the same moment. */
export const MAX_STACKED_POPS = 2;

/** The bit of WAAPI's `Animation` this needs — kept narrow so it is testable without a DOM. */
export interface Cancellable { cancel(): void }

export interface PopSlot {
  /** True once a newer pop pushed this one out. The owner must stop driving its animation (a paused WAAPI
   *  animation revives if its `currentTime` is written after a cancel). */
  readonly evicted: boolean;
  /** The pop ended on its own: free the slot. Safe to call more than once. */
  release(): void;
}

interface Entry { anim: Cancellable; evicted: boolean }

/** Insertion-ordered per element, so the first entry is always the oldest live pop. */
const live = new WeakMap<object, Set<Entry>>();

/** Register a pop that is starting on `el` now, evicting the oldest live pops past the cap. */
export function claimPopSlot(el: object, anim: Cancellable): PopSlot {
  let set = live.get(el);
  if (!set) { set = new Set(); live.set(el, set); }
  while (set.size >= MAX_STACKED_POPS) {
    const oldest = set.values().next().value as Entry;
    set.delete(oldest);
    oldest.evicted = true;
    oldest.anim.cancel();
  }
  const entry: Entry = { anim, evicted: false };
  set.add(entry);
  return {
    get evicted() { return entry.evicted; },
    release: () => { set.delete(entry); },
  };
}

/** Test/diagnostic: how many pops are live on `el`. */
export function livePopCount(el: object): number {
  return live.get(el)?.size ?? 0;
}
