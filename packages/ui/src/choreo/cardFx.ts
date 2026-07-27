import type { CombatEvent } from '@game/core';
import type { MomentKind } from './kinds';

/**
 * Per-CARD authored FX, overriding the moment kind's default def.
 *
 * The `fxDef` channel binds a def to a moment KIND, which is right for anything generic ("a Ward was gained")
 * but cannot express "this specific card's effect looks like this" — Bloodbinder's bleed and every other
 * spell cast share the `scCast` kind, so binding there would give all of them the same effect. This table is
 * the narrower key: card id first, then kind.
 *
 * It mirrors how audio already works (per-card SFX by naming convention), so "this card has its own look"
 * sits alongside "this card has its own sound" rather than being a new concept.
 */
export interface CardFxBinding {
  /** The def id to play instead of the kind's default. */
  def: string;
  /**
   * How to choose the target the effect travels TO.
   *
   * `'primary'` (the default) uses the moment's own source/target pair, which is what every kind-level
   * binding does. `'damaged'` fans out: one play per distinct unit damaged inside the moment, all from the
   * same source. That exists because a cast's own event frequently carries NO target — Bloodbinder emits one
   * `sc` ("Bloodbinder bleeds") and then a separate damage event per marked enemy — so a travelling effect
   * bound to it would have nowhere to travel to, and would silently collapse onto the source.
   */
  fanOut?: 'primary' | 'damaged';
}

/** cardId → moment kind → binding. */
export const CARD_FX: Record<string, Partial<Record<MomentKind, CardFxBinding>>> = {
  // Start of Combat marks enemies; every 4 attacks the marks each take Bloodbinder's Attack. The proc emits
  // one targetless `sc` plus a damage event per mark, so the lance flies to each of them.
  bloodbinder: { scCast: { def: 'ruby-lance', fanOut: 'damaged' } },
};

/** The binding for a card at a kind, or null. `null` cardId (no unit on screen) never matches. */
export function cardFxFor(cardId: string | null, kind: MomentKind): CardFxBinding | null {
  if (cardId === null) return null;
  return CARD_FX[cardId]?.[kind] ?? null;
}

/**
 * The distinct units damaged in the same RESOLUTION STEP as the event at `start` — the fan-out targets.
 *
 * Scanning by step rather than by moment bounds is the load-bearing detail, and the first version got it
 * wrong. `dmg` is a RESULT type, so a run of damage collapses into its own `damage` moment, separate from
 * the `scCast` moment the cast itself lands in: searching the cast's moment found zero damaged units and the
 * effect silently never played. The two are nonetheless one beat as far as the sim is concerned —
 * Bloodbinder's `procBleed` calls `nextStep()` once and then emits the `sc` and every damage under that one
 * step tag — so the step is what actually ties a cast to what it hit.
 *
 * The damage also carries no `source` of its own (see `CombatEvent`), which is the other half of why this
 * has to start from the cast: the cast knows who acted, the damage knows who was hit, and only the shared
 * step joins them.
 *
 * Walks forward from `start` while the step tag holds, so it costs the length of one step and not the log.
 * An UNTAGGED event (legacy replays, synthetic fixtures) has no step to share, so it falls back to scanning
 * the moment's own `[start, end)` range. Distinct + order-preserving: one step can carry two hits on the
 * same unit, and the same travelling effect fired twice at one card reads as a stutter, not as two hits.
 */
export function damagedUidsIn(events: readonly CombatEvent[], start: number, end: number): string[] {
  const step = events[start]?.step;
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (e: CombatEvent | undefined): void => {
    if (e?.type !== 'dmg') return;
    const uid = e.target;
    if (typeof uid !== 'string' || seen.has(uid)) return;
    seen.add(uid);
    out.push(uid);
  };
  if (step === undefined) {
    for (let i = start; i < end; i++) take(events[i]);
    return out;
  }
  for (let i = start; i < events.length && events[i]?.step === step; i++) take(events[i]);
  return out;
}

/**
 * The units an authored per-card effect has CLAIMED for this resolution step, so the stock `damageFx`
 * hit-burst skips them and the authored impact plays instead of on top of the generic one.
 *
 * A claim is needed because the two live in different moments: the authored effect is scheduled from the
 * CAST moment (which knows the acting card) while the burst is scheduled from the separate `damage` moment
 * (whose `dmg` events carry no `source` at all, so it cannot look up a binding itself). The resolution step
 * is the only thing both can see.
 *
 * SINGLE-SLOT on purpose. The damage moment immediately follows its own cast, and claims are made
 * synchronously while scheduling — before the damage moment is reached — so exactly one claim is ever in
 * flight. Holding a map would mean owning its lifetime across replays, restarts and scrubs; keeping one slot
 * means a stale claim is overwritten by the next cast and can never accumulate or leak into a later fight.
 */
let claim: { step: number; uids: Set<string> } | null = null;

/** Claim `uids` for `step`. A step of `undefined` (untagged legacy replay) claims nothing — without a step
 *  there is no key the damage side could match on, and suppressing by uid alone would silence unrelated
 *  hits on the same unit later in the fight. */
export function claimDamageFx(step: number | undefined, uids: readonly string[]): void {
  claim = step === undefined || uids.length === 0 ? null : { step, uids: new Set(uids) };
}

/** Whether `uid` at `step` is covered by an authored effect and should skip its stock burst. */
export function isDamageFxClaimed(step: number | undefined, uid: string): boolean {
  return step !== undefined && claim !== null && claim.step === step && claim.uids.has(uid);
}

/**
 * Drop a standing claim once the replay has moved to a different step. Called once per moment, so a claim
 * can only ever survive within the step that made it.
 *
 * Without this a claim lives until some LATER cast happens to overwrite it, and step numbers restart with
 * each fight — so a claim left over from the end of one combat could silence one hit-burst in the next, on
 * whichever unit happened to reuse that uid and step. Cheap insurance for a bug that would be near
 * impossible to reproduce deliberately.
 */
export function expireDamageFxClaim(step: number | undefined): void {
  if (claim !== null && claim.step !== step) claim = null;
}

/** Test-only: drop any standing claim so cases can't bleed into one another. */
export function resetDamageFxClaims(): void {
  claim = null;
}
