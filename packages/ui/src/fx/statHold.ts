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

/**
 * WHO placed a hold, ordered by HOW MUCH THEY KNOW about when the number should land. Higher wins.
 *
 * `intrinsic` — `Card` noticed its own printed value move. Knows nothing but that something changed, and
 *   exists so a stat change is never silent because an effect was never authored for it.
 * `cue` — a cue that computed a stagger (`Land[]`) and can say when this particular minion's number is due.
 * `effect` — a `react` layer with "Carries the number" ticked. Knows the moment AND owns a clock, so the
 *   store's ticker leaves it alone entirely. Reached two ways: placed outright (`score.ts`), or promoted
 *   from a live lower-ranked hold by `claimStat` when a layer takes an existing cue's number over.
 *
 * Higher replaces lower outright, because they describe the SAME change and the better-informed one should
 * deliver it. Equal accumulates — two of those really are two changes. Lower never overwrites higher, which
 * is what stops `Card`'s intrinsic hold (React flushes layout effects child-first, so it always lands first)
 * from stomping the cue's.
 */
export type HoldOrigin = 'intrinsic' | 'cue' | 'effect';

const RANK: Record<HoldOrigin, number> = { intrinsic: 1, cue: 2, effect: 3 };

interface Hold extends StatDelta {
  /** See `HoldOrigin`. Decides accumulate-vs-replace when a second hold lands on a live one. */
  origin: HoldOrigin;
  /**
   * How much of the withheld change has been REVEALED, 0..1. 0 shows the old number, 1 shows the new one,
   * and anything between is the counter mid-roll.
   *
   * This is what turns a hold from a switch into a dial. A release is just `reveal(1)`; a spin walks it.
   */
  revealed: number;
  /**
   * REEL amplitude: how far the counter overshoots either side of its true path while rolling, in points.
   *
   * 0 is the honest odometer — it only ever prints values between the old number and the new one. That is
   * correct and, for a +1 buff, invisible: there is nothing between 4 and 5, so the roll has two states and
   * reads as a snap however long it runs. A gem is +1/+1, which made the feature do nothing in the most
   * common case in the game.
   *
   * A non-zero reel adds a DECAYING wobble around the interpolated value, so a 1-point change still has
   * something to spin through. It is deliberately a wobble rather than "start N below and climb": the
   * wobble is zero at both ends by construction (see `heldFor`), so the counter still begins on exactly the
   * old number and lands on exactly the new one. No frame shows a value outside the spin, and the landing
   * is never approximate.
   */
  reel: number;
  /** Milliseconds after the hold was placed at which delivery BEGINS. 0 = immediately.
   *  This is what makes a cascade a cascade: the seventh minion's number is withheld until its own gem. */
  startAt: number;
  /** How long the reveal takes once it starts. Ignored for `effect` holds — their player owns the clock. */
  rollMs: number;
  /** `performance.now()` past which this hold is ignored. See the header: an unclaimed hold must not be
   *  permanent, so every hold expires on its own. */
  until: number;
  /** `now()` at which this hold was placed — `startAt` is an offset, and the ticker needs the origin point
   *  to know when "later" has arrived. */
  placedAt: number;
}

/**
 * How long an unclaimed hold survives. Sized against the effects that would claim one: the authored gem
 * apply runs 900ms end to end, and a react layer peaks well inside that. Past this the badge simply tells
 * the truth — a slightly early reveal, never a wrong number.
 */
export const HOLD_TTL_MS = 1200;

/** The roll a hold gets when its placer doesn't specify one. */
export const DEFAULT_ROLL_MS = 420;

/** Slack past a scheduled delivery before the TTL force-delivers it. Long enough that a frame or two of
 *  jank never truncates a roll, short enough that a stranded hold clears before anyone reads the badge. */
export const HOLD_GRACE_MS = 200;

const holds = new Map<string, Hold>();
const listeners = new Set<() => void>();
/**
 * uid → the timer that force-delivers an unclaimed hold.
 *
 * The TTL used to be enforced only by `heldFor` sweeping on READ, which quietly wasn't enough: a badge
 * nobody is re-rendering never reads, so a hold whose effect never released it sat on the old number until
 * some unrelated render happened along. That is reachable by authoring alone — take the `carries` layer off
 * a def and the cue still holds with nothing left to deliver (owner report: a gem apply that didn't update
 * until they clicked again). An expiry that has to be ASKED isn't an expiry, so it fires on its own clock.
 */
const expiries = new Map<string, ReturnType<typeof setTimeout>>();

/** Drop any pending expiry for a uid. Safe when none is armed. */
function disarm(uid: string): void {
  const t = expiries.get(uid);
  if (t !== undefined) {
    clearTimeout(t);
    expiries.delete(uid);
  }
}

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
 *
 * ── except when the two holds are the SAME change seen twice ─────────────────────────────────────────
 * `Card`'s intrinsic roll fires off the value moving; a better-informed cue or effect holds the same delta
 * for the same commit. React flushes layout effects CHILD FIRST, so the card's intrinsic hold reliably lands
 * before the parent's, and accumulating them would withhold +2/+2 for a +1/+1 gem — a badge printing a
 * number the unit never had, which is the exact failure this module exists to prevent.
 *
 * So `origin` is a RANK that breaks the tie: a higher-ranked hold REPLACES a live lower one (same change,
 * and the better-informed clock is the one the player was meant to see), and a lower-ranked hold never lands
 * on top of a higher one. Same-rank holds accumulate as before, because two of those really are two changes.
 */
export function holdStat(
  uid: string,
  delta: Partial<StatDelta>,
  opts: { ttlMs?: number; origin?: HoldOrigin; startAt?: number; rollMs?: number } = {},
): void {
  const { ttlMs, origin = 'effect', startAt = 0, rollMs = DEFAULT_ROLL_MS } = opts;
  const attack = delta.attack ?? 0;
  const health = delta.health ?? 0;
  if (attack === 0 && health === 0) return;
  const prev = holds.get(uid);
  const live = prev !== undefined && prev.until > now();
  // A better-informed placer owns this change; a worse-informed one stands down rather than stacking a
  // second copy of the same delta on top of it.
  if (live && RANK[origin] < RANK[prev.origin]) return;
  // …and supersedes outright, so its delta lands whole and its roll starts from the top instead of
  // inheriting a fraction the lower-ranked one had already shown.
  const supersedes = live && RANK[origin] > RANK[prev.origin];
  // Carry the UNREVEALED remainder, not the whole previous delta. A hold half-way through its roll has
  // already shown half its change; adding the full old delta back would put the badge further behind than
  // it ever was — printing a number the unit never had. (Caught by test, not by eye.)
  //
  // The remainder is the EASED one (`withheldFraction`, same curve the badge is printing), not the linear
  // `1 - revealed`. `heldFor` shows the eased amount, so a mid-roll top-up that added back the linear
  // remainder would owe MORE than the badge is currently showing and tick it backward on the new buff.
  const carry = live && !supersedes;
  const owedAttack = carry ? Math.round(prev.attack * withheldFraction(prev.revealed)) : 0;
  const owedHealth = carry ? Math.round(prev.health * withheldFraction(prev.revealed)) : 0;
  // The TTL has to outlast the SCHEDULE, or the failsafe force-delivers the tail of a long cascade before
  // its own gem arrives — the exact desync this feature exists to remove, reintroduced by the safety net.
  // `HOLD_TTL_MS` stays the floor: an unscheduled effect hold still needs room for a react layer to peak.
  const lifetimeMs = ttlMs ?? Math.max(HOLD_TTL_MS, startAt + rollMs + HOLD_GRACE_MS);
  const placedAt = now();
  holds.set(uid, {
    origin,
    attack: owedAttack + attack,
    health: owedHealth + health,
    // The reveal restarts against the new total: keeping the old fraction would silently reveal part of a
    // change nobody animated.
    revealed: 0,
    reel: 0,
    startAt,
    rollMs,
    until: placedAt + lifetimeMs,
    placedAt,
  });
  // Restart the clock, never inherit the old deadline: a fresh hold is a fresh change, and letting it die
  // on the previous one's timer would cut a just-started roll short.
  disarm(uid);
  expiries.set(uid, setTimeout(() => {
    expiries.delete(uid);
    // Fail OPEN. Whatever was going to claim this never did, so show the truth — and NOTIFY, because a
    // silent sweep leaves the badge rendering the withheld number until something else re-renders it.
    if (holds.delete(uid)) emit();
  }, lifetimeMs));
  emit();
  ensureTicking();
}

/**
 * Who owns the live hold on a unit, or `null` when nothing is held.
 *
 * `Card`'s intrinsic roll polls this to notice it has been SUPERSEDED: once a higher-ranked hold takes the
 * change over, the intrinsic rAF loop must stop driving `revealStat` or two clocks fight over one counter
 * and the digits stutter. Expired holds read as absent, exactly as in `heldFor`.
 */
export function holdOrigin(uid: string): HoldOrigin | null {
  const h = holds.get(uid);
  if (h === undefined) return null;
  if (h.until <= now()) {
    holds.delete(uid);
    return null;
  }
  return h.origin;
}

/**
 * Hand a live hold's clock over to the effect that is about to drive it. No-op when nothing is held.
 *
 * `stepHolds` drives every hold whose origin is not `effect`, which is what makes a `cue` hold self-
 * delivering with no authoring anywhere. The moment a `react` layer with `carries` starts driving the same
 * uid there would be TWO clocks on one counter: `revealQuiet` is monotonic, so whichever is further ahead
 * wins each frame, and the ticker reaching `p >= 1` first DELETES the hold — every later `revealStat` /
 * `releaseStat` from the authored player then no-ops against nothing, and an authored roll longer than
 * `DEFAULT_ROLL_MS` is silently discarded. Promoting the origin is what makes the ticker stand down.
 *
 * Deliberately NOT a fresh `holdStat` at `effect` rank: that restarts `revealed` and re-arms the expiry, so
 * a hold the ticker had already walked part-way would tick BACKWARDS on the handover. Only the owner
 * changes here. The delta, the schedule and the expiry all survive — the expiry especially, because a layer
 * that claims a number and then never delivers it (a def torn down mid-play, a `carries` layer whose peak
 * never arrives) must still fail OPEN.
 *
 * KNOWN CEILING: a layer can only claim from the moment it SPAWNS, which is its own `at` in the def. Arm a
 * carrying layer late enough that the cue's roll has already run to completion and there is nothing left to
 * claim — the automatic floor has delivered, the hold is gone, and this is a no-op. That degrades to the
 * pre-`claimStat` behaviour for that authoring; it never prints a wrong number, because the reveal is
 * monotonic and a delivered hold simply does not exist. Closing it properly means the PLAYER knowing at fire
 * time that some layer carries the number, which is a def-level fact this primitive cannot see.
 */
/**
 * TWO WAYS TO NOT DOUBLE-WITHHOLD ONE CHANGE.
 *
 * `holdStat` accumulates equal-rank holds on purpose — two `effect`-rank placements usually ARE two changes.
 * But a Ruby landing in combat is placed by two different sites for the SAME change (the replay's per-beat
 * pass and the choreographer's per-Ruby pass), and accumulating there withholds it twice: the badge prints
 * `current - 2x`, a value the unit never had, below its own floor, which is what paints the plate red
 * (owner report 2026-08-31 — "the stats dance around a lot in combat, setting to randomly low values").
 *
 * Neither site can assume it runs first, so both got a rule, and they are named here rather than open-coded
 * so the pair stays legible as ONE decision:
 *
 *  · `claimOrHold` — for the placer whose delta is a PART of the change (the per-Ruby cue). If something is
 *    already withholding this unit, that hold covers this Ruby too; take it over so the effect still delivers
 *    the number, and add nothing.
 *  · `replaceHold` — for the placer whose delta is the WHOLE change (the replay's beat pass, which nets
 *    same-beat damage into Health). It is authoritative, so it drops whatever is live and places its own.
 *
 * Whichever order they run in, exactly one hold survives carrying the beat's true total.
 */
export function claimOrHold(
  uid: string,
  delta: Partial<StatDelta>,
  opts?: { ttlMs?: number; origin?: HoldOrigin; startAt?: number; rollMs?: number },
): void {
  if (heldFor(uid)) { claimStat(uid); return; }
  holdStat(uid, delta, opts);
}

/** See `claimOrHold`. Drops any live hold, then places this one as the single authority for the unit. */
export function replaceHold(
  uid: string,
  delta: Partial<StatDelta>,
  opts?: { ttlMs?: number; origin?: HoldOrigin; startAt?: number; rollMs?: number },
): void {
  if (heldFor(uid)) releaseStat(uid);
  holdStat(uid, delta, opts);
}

export function claimStat(uid: string): void {
  const h = holds.get(uid);
  if (h === undefined || h.until <= now()) return;
  h.origin = 'effect';
}

/** A live hold's delivery schedule, or `null`. For tests and for the ticker. */
export function scheduleFor(uid: string): { startAt: number; rollMs: number } | null {
  const h = holds.get(uid);
  if (h === undefined || h.until <= now()) return null;
  return { startAt: h.startAt, rollMs: h.rollMs };
}

/** Show it: drop the whole hold for a unit. Safe to call when nothing is held. */
export function releaseStat(uid: string): void {
  disarm(uid);
  if (holds.delete(uid)) emit();
}

/** Drop every hold. For a scene change (combat ends, a run is abandoned) where the units are gone and any
 *  surviving hold would apply to whatever reuses the uid. */
export function releaseAllStats(): void {
  for (const t of expiries.values()) clearTimeout(t);
  expiries.clear();
  if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
  if (holds.size === 0) return;
  holds.clear();
  emit();
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** The reveal itself, WITHOUT notifying. Returns whether anything actually moved.
 *  Split out so `stepHolds` can advance many holds and emit once; `revealStat` is this plus an emit. */
function revealQuiet(uid: string, progress: number): boolean {
  const h = holds.get(uid);
  if (h === undefined) return false;
  const p = Math.max(0, Math.min(1, progress));
  if (p <= h.revealed) return false;   // MONOTONIC — a counter that ticked back reads as an arithmetic bug
  if (p >= 1) { disarm(uid); holds.delete(uid); return true; }
  h.revealed = p;
  return true;
}

/**
 * Reveal `progress` (0..1) of a unit's withheld change — the counter mid-roll.
 *
 * MONOTONIC: a lower progress than the hold already has is ignored. Two effects can be mid-flight on one
 * unit (a gem cascade overlapping a combat buff), and a counter that ticked forward and then jumped back
 * would read as a bug in the game's arithmetic rather than as an animation. Reaching 1 releases outright,
 * so a completed spin leaves no entry behind.
 */
export function revealStat(uid: string, progress: number, reel = 0): void {
  // The reel is stamped only when the reveal actually ADVANCES, and that ordering is load-bearing rather
  // than tidy: a call the monotonic check rejects is a call from a clock that is behind, and letting it set
  // the amplitude anyway lets a stale driver's reel ride a reveal it did not produce. `heldFor` adds the
  // wobble on top of the withheld remainder, so an oversized reel against an early `revealed` can push the
  // withheld amount past the whole delta — and `Card` only floors the printed value at 0, so the badge
  // would print BELOW the number the minion had before the buff.
  if (!revealQuiet(uid, progress)) return;
  const h = holds.get(uid);
  if (h !== undefined) h.reel = Math.max(0, reel);
  emit();
}

let raf = 0;

/** Start the loop if it isn't already running. Called whenever a hold is placed. */
function ensureTicking(): void {
  if (raf !== 0 || typeof requestAnimationFrame === 'undefined') return;
  const loop = (): void => {
    stepHolds();
    raf = holds.size > 0 ? requestAnimationFrame(loop) : 0;
  };
  raf = requestAnimationFrame(loop);
}

/**
 * Advance every hold the store owns. Exported for tests, which have no rAF.
 *
 * `emit` fires ONCE at the end rather than per hold. That is not a micro-optimisation: every mounted card
 * subscribes, so a per-hold emit makes N rolling badges cost N × (every card on screen) snapshot reads per
 * frame, most of them cards answering "nothing changed for me".
 */
export function stepHolds(): void {
  const t = now();
  let changed = false;
  for (const [uid, h] of [...holds]) {
    if (h.origin === 'effect') continue;      // its player owns the clock
    if (t < h.placedAt + h.startAt) continue; // scheduled for later in the cascade
    const p = h.rollMs <= 0 ? 1 : (t - h.placedAt - h.startAt) / h.rollMs;
    if (revealQuiet(uid, Math.min(1, p))) changed = true;
  }
  if (changed) emit();
}

/**
 * How many times a reeling counter swings either way across the roll. Fixed rather than authored: it is the
 * difference between "a counter settling" and "a number flickering", and there is one right answer for a
 * 200-400ms roll. The AMPLITUDE is the expressive knob; the rate is not.
 */
export const REEL_TURNS = 3;

/**
 * EASE-OUT on the value roll: given how much of a change has been REVEALED (0..1), what fraction is still
 * WITHHELD. Linear would be `1 - revealed`; raising it to a power front-loads the reveal so the counter
 * sprints out of the gate and settles slowly onto its final digit — "the number roll slows down as it nears
 * the display value". Zero at `revealed = 1` by construction, so the badge still lands exactly on the true
 * number, and monotonic in `revealed`, so the counter never ticks backward.
 *
 * The EXPONENT is the settle knob (owner-tuned 2026-08-07, cubic → quad): a HIGHER power front-loads harder
 * and settles EARLIER (the digits reach the final value in the first third, then sit still); a LOWER power is
 * gentler and keeps the count MOVING later into the roll — a slower, more visible settle at the end. `t * t`
 * (quad) is the current tuning; `t * t * t` (cubic) is snappier, `t` is a plain linear odometer.
 *
 * This is the ONLY place the curve lives. `revealed` itself still advances with real time (the shared ticker
 * and combat's `driveRoll` are untouched), so a mid-roll speed change still re-scales cleanly; only the
 * mapping from that fraction to a printed number eases. `holdStat` reads the same curve so a mid-roll top-up
 * owes exactly what the badge is showing.
 */
export function withheldFraction(revealed: number): number {
  const t = 1 - Math.max(0, Math.min(1, revealed));
  return t * t;
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
  // What is STILL withheld: the part not yet revealed, rounded so the badge only ever prints whole numbers
  // and steps through them one at a time. A hold fully revealed by rounding reads as absent, which is what
  // stops a 1-point buff from sitting visibly stuck at 0.4 revealed.
  //
  // The value uses the EASED remainder so the counter decelerates into its final digit; the reel keeps the
  // LINEAR remainder so a +1/+1 buff's spin is exactly as before — only the main roll eases.
  const tLinear = 1 - h.revealed;
  const tEased = withheldFraction(h.revealed);
  // The wobble is scaled by `tLinear`, so it is exactly 0 at both ends: the counter starts on the old number
  // and lands on the new one no matter how wild the reel. Everything in between is motion, not a readout.
  const wobble = h.reel * tLinear * Math.sin(2 * Math.PI * REEL_TURNS * h.revealed);
  const attack = Math.round(h.attack * tEased + wobble * Math.sign(h.attack || 1));
  const health = Math.round(h.health * tEased + wobble * Math.sign(h.health || 1));
  return attack === 0 && health === 0 ? null : { attack, health };
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
