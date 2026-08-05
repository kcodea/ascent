/**
 * WITHHOLDING a summoned unit until an effect says to show it.
 *
 * The sibling of `statHold.ts`, and the same complaint one layer over: *"the cubs come out immediately,
 * before the timing of the effect takes place"* (owner, 2026-08-05, watching Echohorn Rally a Manasaber).
 *
 * ── why the unit is early, precisely ─────────────────────────────────────────────────────────────────
 * Nothing can delay the Deathrattle itself. By replay time `combat.events` is a finished log and
 * `computeFrame` is a pure fold over it; the summon has already happened. What is early is the FRAME
 * COMMIT: the frame deliberately shows the current beat's OUTCOME while that beat's FX plays (see the
 * `preBuffHolds` layout effect in useCombatReplay.ts), so the cub is spliced onto the board the instant
 * the wind-up moment becomes current — ahead of the sparkle that is supposed to be delivering it.
 *
 * So this withholds the unit from the RENDERED board, exactly as `statHold` withholds digits from a badge.
 * Presentation only: the truth frame is untouched, which is why `useCombatReplay` exposes the filtered view
 * as `visibleFrame` and leaves `frame` alone — the loss-damage tally counts survivors off `frame`, and a
 * held unit is a live minion, not a missing one.
 *
 * ── who holds and who releases ───────────────────────────────────────────────────────────────────────
 * The LAYOUT EFFECT holds (pre-paint) and the CUE releases. That split is not stylistic: `runMomentCues`
 * runs from a post-paint effect, so holding there would paint the cub for one frame, remove it, then bring
 * it back — the same up-then-down-then-up artifact the buff holds were moved to a layout effect to kill.
 *
 * ── failing open ─────────────────────────────────────────────────────────────────────────────────────
 * A hold nobody releases MUST NOT be permanent, and the stakes are higher here than for a badge: a stranded
 * hold doesn't show a wrong number, it hides a minion that is really on the board and really fighting. The
 * release timers live in the cue's teardown, so a seek, a speed change or a moment advance can cancel them;
 * the TTL is what guarantees the unit appears anyway. Failing open — showing a unit slightly early — is the
 * only acceptable direction.
 */

/** uid → `performance.now()` past which the hold is ignored. Presence IS the hold; there is no payload,
 *  which is the whole difference from `statHold`'s delta. */
const holds = new Map<string, number>();
const listeners = new Set<() => void>();

/**
 * How long an unclaimed hold survives.
 *
 * Sized against what claims one: the rally cue leads by the wind-up (~740ms at the default 0.54s) and then
 * cascades, so a gilded double proc's second land is ~860ms in. 2500 leaves headroom for a slow replay speed
 * without ever being long enough for a missing minion to read as a bug rather than a beat.
 */
export const SUMMON_HOLD_TTL_MS = 2500;

let version = 0;

function emit(): void {
  version++;
  for (const l of listeners) l();
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function subscribeSummonHolds(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A stable primitive for `useSyncExternalStore`. Global rather than per-uid (the opposite of
 *  `statHoldKey`): the consumer is ONE filter over the whole board, not a per-card lookup, so there is no
 *  per-card render to spare and a single counter is the cheaper snapshot. */
export function summonHoldVersion(): number {
  return version;
}

/** Withhold a summoned unit from the rendered board. Idempotent: re-holding refreshes the expiry rather
 *  than stacking, since presence is the whole state. */
export function holdSummon(uid: string, ttlMs = SUMMON_HOLD_TTL_MS): void {
  holds.set(uid, now() + ttlMs);
  emit();
}

/** Show it. Safe to call when nothing is held — which is the common case, since the cue releases every land
 *  whether or not the layout effect got there first. */
export function releaseSummon(uid: string): void {
  if (holds.delete(uid)) emit();
}

/** Release several at once with ONE notification — a single proc can deliver a whole litter (Manasaber's
 *  two cubs), and they must appear together rather than as a ripple. */
export function releaseSummons(uids: readonly string[]): void {
  let changed = false;
  for (const uid of uids) if (holds.delete(uid)) changed = true;
  if (changed) emit();
}

/** Drop every hold. For a scene change — combat ends, a seek, a fresh fight — where the units are gone and
 *  a surviving hold would hide whatever reuses the uid. */
export function releaseAllSummons(): void {
  if (holds.size === 0) return;
  holds.clear();
  emit();
}

/**
 * Is this unit currently withheld? Expired holds read as absent AND are swept here, so a hold whose release
 * timer was cancelled cannot leak. Swept on read rather than on a timer, like `statHold`: nothing in this
 * module ticks, and during a replay something reads every frame.
 */
export function isSummonHeld(uid: string): boolean {
  const until = holds.get(uid);
  if (until === undefined) return false;
  if (until <= now()) {
    holds.delete(uid);
    return false;
  }
  return true;
}

/** True when anything at all is held — lets the render path skip filtering entirely in the common case,
 *  which is every frame of every fight that contains no bound Rally. */
export function anySummonHeld(): boolean {
  return holds.size > 0;
}
