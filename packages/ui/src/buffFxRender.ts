import type { Tribe } from '@game/core';
import { playDef } from './fx/playDef';
import tendrilTrail from './fx/defs/tendril-trail.json';
import { DESCEND_PRESETS, descendPreset } from './descendPresets';
import { tunedDescend } from './buffFxConfig';

/**
 * The flight time of `tendril-trail`'s ribbon, read from the def itself rather than pinned here — the stat-badge
 * roll is scheduled to land when the ribbon ARRIVES, so retuning the ribbon's `travelMs` in the workbench moves
 * the roll with it and nothing has to be kept in sync by hand. The burst layer has its own (tiny) `travelMs`,
 * hence the primitive check. 384 is the authored value at the time of writing, kept only as a safety net.
 */
const TENDRIL_TRAIL_TRAVEL_MS: number =
  tendrilTrail.layers.find((l) => l.primitive === 'ribbon')?.travelMs ?? 384;

/**
 * Fire ONE generic buff-other effect and return the strike/landing time (ms) so the caller can schedule the
 * target's stat-badge roll. The single path shared by the combat replay (`useCombatReplay.fireBuffCasts`) and
 * the shop (`Recruit`'s recruitFxSeq effect / End-of-Turn beats).
 *
 * A LIVING source plays the owner-authored `tendril-trail` def (2026-09-02) — a ribbon streaming source→target
 * with a flick of shards at the source — and returns the ribbon's flight time. It replaced the stripped
 * procedural tendril on the same moment, and it is GENERIC by design: a card's own authored def (Dragonflame,
 * Karwind, Broodfire, a label-sourced hero power) is resolved UPSTREAM of this function and never reaches it,
 * so binding a card never draws two effects for one buff.
 *
 * `sourceless` (a spell, a fallen Echo, or a missing source rect) has no replacement authored yet: it draws
 * nothing and returns the descend preset's drop time, so the roll stays on the clock the old rain-down used.
 */
export function fireBuffFx(o: {
  source?: { x: number; y: number };
  target: { x: number; y: number };
  cardId: string;
  tribe: Tribe;
  sourceless: boolean;
  /** The buffer and the buffed unit, handed to `playDef` so a `react` layer knows which cards this is about
   *  (see `playDefUids.test.ts` — an effect that forgets them plays on nobody). */
  uids?: { source?: string | null; target?: string | null };
}): number {
  if (o.sourceless || !o.source) {
    return tunedDescend(DESCEND_PRESETS[descendPreset(o.cardId, o.tribe)]!).dropMs;
  }
  playDef('tendril-trail', { source: o.source, target: o.target }, { uids: o.uids });
  return TENDRIL_TRAIL_TRAVEL_MS;
}
