/**
 * WITHHOLDING a stat change until an effect says to show it.
 *
 * The problem this solves, in the owner's words: *"I want the number update to follow that same timing."*
 * A badge's digits come from React state, so they snap to the new value the instant the reducer commits —
 * on their own schedule, with no relationship to the effect playing over them. The plate can pop, but by
 * then the number has already changed, so the pop decorates a number rather than delivering it.
 *
 * ── the shape ────────────────────────────────────────────────────────────────────────────────────────
 * A hold is a DELTA to subtract, not an absolute value. That matters: absolutes go stale the moment
 * anything else touches the unit (a second buff, a trade, a re-render from unrelated state), and a stale
 * absolute is a badge showing a number that was never true. A delta stays correct under all of them — it
 * says "show two less than whatever you currently are", so the badge tracks live state minus the part the
 * player hasn't been shown yet.
 *
 * ── who sets and who clears ──────────────────────────────────────────────────────────────────────────
 * The CUE holds (it reads the delta off the combat event; no authoring needed) and the DEF releases (a
 * `react` layer with `carries` ticked, at its peak). Split that way because only the cue knows the number
 * and only the author knows the moment.
 *
 * **A hold nobody claims must not be permanent.** If no layer carries the number — every effect authored
 * before this existed, and every def that simply doesn't opt in — the badge would sit wrong forever. So a
 * hold carries its own expiry and `heldFor` treats an expired hold as absent. The default expiry is short
 * enough to be invisible if unclaimed and long enough for a layer to claim it. Failing OPEN (showing the
 * true number) is the only safe direction: a stat badge is load-bearing information, and the rule this
 * codebase keeps re-learning is that a silent wrong answer costs more than a loud absence.
 */

export interface StatDelta {
  /** How much of the unit's CURRENT attack has not been shown yet. */
  attack: number;
  /** How much of the unit's CURRENT health has not been shown yet. */
  health: number;
}

interface Hold extends StatDelta {
  /** `performance.now()` past which this hold is ignored. See the header: an unclaimed hold must not be
   *  permanent, so every hold expires on its own. */
  until: number;
}

/**
 * How long an unclaimed hold survives. Sized against the effects that would claim one: the authored gem
 * apply runs 900ms end to end, and a react layer peaks well inside that. Past this the badge simply tells
 * the truth — a slightly early reveal, never a wrong number.
 */
export const HOLD_TTL_MS = 1200;

const holds = new Map<string, Hold>();
const listeners = new Set<() => void>();

/** Bumped on every change so `useSyncExternalStore` has a cheap, stable snapshot to compare. Returning the
 *  Map itself would be a new reference only when we mutate it in place — which we do — so a counter is both
 *  cheaper and honest about what changed. */
let version = 0;

function emit(): void {
  version++;
  for (const l of listeners) l();
}

export function subscribeStatHolds(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function statHoldVersion(): number {
  return version;
}

/**
 * Withhold `delta` of a unit's stats from the badge until something releases it (or it expires).
 *
 * Deltas ACCUMULATE: two gems landing in one moment withhold both, so the badge steps once per release
 * rather than jumping the whole way on the first. A zero delta is not stored — nothing to withhold is not
 * the same as a hold of nothing, and storing it would make `heldFor` report a hold that changes no digit.
 */
export function holdStat(uid: string, delta: Partial<StatDelta>, ttlMs = HOLD_TTL_MS): void {
  const attack = delta.attack ?? 0;
  const health = delta.health ?? 0;
  if (attack === 0 && health === 0) return;
  const prev = holds.get(uid);
  const live = prev !== undefined && prev.until > now();
  holds.set(uid, {
    attack: (live ? prev.attack : 0) + attack,
    health: (live ? prev.health : 0) + health,
    until: now() + ttlMs,
  });
  emit();
}

/** Show it: drop the whole hold for a unit. Safe to call when nothing is held. */
export function releaseStat(uid: string): void {
  if (holds.delete(uid)) emit();
}

/** Drop every hold. For a scene change (combat ends, a run is abandoned) where the units are gone and any
 *  surviving hold would apply to whatever reuses the uid. */
export function releaseAllStats(): void {
  if (holds.size === 0) return;
  holds.clear();
  emit();
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * What is currently withheld for a unit, or `null`.
 *
 * Expired holds read as absent AND are swept here, so a unit that scrolled off screen (or a def that never
 * claimed its hold) can't leak an entry. Sweeping on read rather than on a timer keeps this module free of
 * its own clock — nothing here ticks.
 */
export function heldFor(uid: string): StatDelta | null {
  const h = holds.get(uid);
  if (h === undefined) return null;
  if (h.until <= now()) {
    holds.delete(uid);
    return null;
  }
  return { attack: h.attack, health: h.health };
}

/** True when anything at all is held — lets a render path skip the per-card lookup in the common case. */
export function anyStatHeld(): boolean {
  return holds.size > 0;
}

/**
 * A PRIMITIVE snapshot of one unit's hold, for `useSyncExternalStore`.
 *
 * Per-uid rather than a global version on purpose: a card with nothing held returns 0 before and after any
 * other card's hold changes, so React skips it entirely. A global counter would re-render every card on
 * the board every time one of them was gemmed — cheap per event, but this is the render path the
 * performance rules are about, and the per-uid version costs nothing extra. Mirrors `getSpellBuffSeq`.
 *
 * Encoded rather than an object because `getSnapshot` must be referentially stable: returning a fresh
 * `{attack, health}` each call makes React re-render forever.
 */
export function statHoldKey(uid: string): number {
  const h = heldFor(uid);
  return h === null ? 0 : h.attack * 1_000 + h.health;
}
