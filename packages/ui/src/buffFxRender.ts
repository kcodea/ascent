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

/** Tribes with a per-tribe `tendril-trail-<tribe>` variant (a palette-swap of the generic). `neutral` and the
 *  archived `celestial` are absent — they keep the generic ribbon, as does any tribe not listed here. */
const TENDRIL_TRIBES = new Set<Tribe>(['beast', 'demon', 'dragon', 'dwarf', 'kobold', 'mech', 'undead', 'spirit']);

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
  // PER-TRIBE RIBBON: the BUFFER's tribe picks its variant (Warhorn Captain = dwarf → `tendril-trail-dwarf`).
  // Each variant is a palette-swap of the generic, so its ribbon travelMs is unchanged and the roll still lands
  // on `TENDRIL_TRAIL_TRAVEL_MS` for all of them. A listed tribe fires a DATA-RESOLVED id (a dynamic playDef —
  // see `fx/directCalls.ts`); neutral / an unlisted tribe keeps the literal generic.
  if (TENDRIL_TRIBES.has(o.tribe)) {
    playDef(`tendril-trail-${o.tribe}`, { source: o.source, target: o.target }, { uids: o.uids });
  } else {
    playDef('tendril-trail', { source: o.source, target: o.target }, { uids: o.uids });
  }
  return TENDRIL_TRAIL_TRAVEL_MS;
}
