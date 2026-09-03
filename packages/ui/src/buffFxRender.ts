import type { Tribe } from '@game/core';
import { BUFF_PRESETS, buffPreset } from './buffPresets';
import { DESCEND_PRESETS, descendPreset } from './descendPresets';
import { tunedDescend } from './buffFxConfig';

/**
 * The TIMING a buff-other moment hands back so the target's stat-badge roll stays on the exact clock it always
 * rode — and NOTHING else. The generic source→target tendril and the sourceless descend VISUALS were stripped
 * 2026-09-02 (owner ask: every stock shop/combat buff cue is being replaced by an authored pixi effect). The
 * moment, its data (`recruitBuffFx` / the `buffCast` channel), and this flight time are all untouched, so a
 * replacement effect can be fired at the call sites (`useCombatReplay.fireBuffCasts`, `Recruit`'s recruitFxSeq
 * effect) and drive the roll off its own travel — this just draws nothing in the meantime.
 *
 * `sourceless` (spell / dead Deathrattle, or a missing source rect) returns the descend's drop time; a living
 * source returns the tendril's travel time. Kept as a preset read, not a constant, so the roll pacing is
 * byte-identical to before the visual came out.
 */
export function fireBuffFx(o: {
  source?: { x: number; y: number };
  target: { x: number; y: number };
  cardId: string;
  tribe: Tribe;
  sourceless: boolean;
}): number {
  if (o.sourceless || !o.source) {
    return tunedDescend(DESCEND_PRESETS[descendPreset(o.cardId, o.tribe)]!).dropMs;
  }
  return BUFF_PRESETS[buffPreset(o.cardId, o.tribe)].travelMs;
}
