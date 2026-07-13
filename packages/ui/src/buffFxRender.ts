import type { Tribe } from '@game/core';
import { pixiFx } from './pixiFx';
import { BUFF_PRESETS, buffPreset } from './buffPresets';
import { DESCEND_PRESETS, descendPreset } from './descendPresets';

/** Fire ONE buff-other effect on the shared FX overlay and return the strike/landing time (ms) so the caller
 *  can schedule its stat-badge flash. `sourceless` (spell / dead Deathrattle, or a missing source rect) rains a
 *  descend onto the target; otherwise a source→target tendril. The single render path shared by the combat
 *  replay (`useCombatReplay.fireBuffCasts`) and the shop (`Recruit` recruitFxSeq effect). */
export function fireBuffFx(o: {
  source?: { x: number; y: number };
  target: { x: number; y: number };
  cardId: string;
  tribe: Tribe;
  sourceless: boolean;
}): number {
  if (o.sourceless || !o.source) {
    const d = DESCEND_PRESETS[descendPreset(o.cardId, o.tribe)];
    pixiFx.descend(o.target.x, o.target.y, d);
    return d.dropMs;
  }
  const t = BUFF_PRESETS[buffPreset(o.cardId, o.tribe)];
  pixiFx.buffTendril(o.source, o.target, t);
  return t.travelMs;
}
