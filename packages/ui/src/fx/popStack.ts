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

/** The bit of WAAPI's `Animation` `popsOn` reads off a scheduled pop. */
export interface ScheduledPop { readonly effect: { getComputedTiming(): { progress?: number | null } } | null }

/**
 * Pops CREATED on an element but not claimed yet: the `react` layer builds its additive pops paused, ahead of the
 * moment they land, and claims a slot only once its clock reaches them. Kept so `popsOn` sees them.
 */
const scheduled = new WeakMap<object, Set<ScheduledPop>>();

/** Note an additive pop built on `el` that will play later (the `react` layer, R-PERF-BADGE-POP-01). */
export function noteScheduledPop(el: object, anim: ScheduledPop): void {
  let set = scheduled.get(el);
  if (!set) { set = new Set(); scheduled.set(el, set); }
  set.add(anim);
}

/**
 * Is any other scale pop on `el` playing or still to play (R-PERF-BADGE-POP-01)? A claimed pop counts, and so does a
 * scheduled one whose effect is still inside its active interval (paused at its start counts; finished or
 * cancelled does not, and is dropped here). `Card`'s number pop runs in the replace mode, on the compositor, only
 * when this is false, so an authored pop built earlier on the same badge is never covered by it.
 */
export function popsOn(el: object): boolean {
  if ((live.get(el)?.size ?? 0) > 0) return true;
  const set = scheduled.get(el);
  if (!set) return false;
  let any = false;
  for (const a of set) {
    const p = a.effect?.getComputedTiming().progress;
    if (p === null || p === undefined) set.delete(a);
    else any = true;
  }
  return any;
}
