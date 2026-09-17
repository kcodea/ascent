import type { Tribe } from '@game/core';
import { playDef } from './fx/playDef';
import tendrilTrail from './fx/defs/tendril-trail.json';
import { DESCEND_PRESETS, descendPreset } from './descendPresets';
import { getBuffFxConfig, tunedDescend } from './buffFxConfig';
import { sfx } from './sfx';

/**
 * The flight time of `tendril-trail`'s ribbon, read from the def itself rather than pinned here — the stat-badge
 * roll is scheduled to land when the ribbon ARRIVES, so retuning the ribbon's `travelMs` in the workbench moves
 * the roll with it and nothing has to be kept in sync by hand. The burst layer has its own (tiny) `travelMs`,
 * hence the primitive check. 384 is the authored value at the time of writing, kept only as a safety net.
 */
const TENDRIL_TRAIL_TRAVEL_MS: number =
  tendrilTrail.layers.find((l) => l.primitive === 'ribbon')?.travelMs ?? 384;

/** Tribes with a per-tribe `tendril-trail-<tribe>` variant (a palette-swap of the generic). `neutral` alone keeps
 *  the generic ribbon. `celestial` joined 2026-09-14 (owner report: Wishing Star drew the default) with a
 *  moonlit-periwinkle palette swap of the generic — a PLACEHOLDER for the owner to retune in the workbench. */
/** Spirit hits fired within this many ms of each other count as ONE burst for the stagger. */
const SPIRIT_BURST_WINDOW_MS = 120;
let spiritBurstAt = -Infinity;
let spiritBurstIdx = 0;

const TENDRIL_TRIBES = new Set<Tribe>(['beast', 'celestial', 'demon', 'dragon', 'dwarf', 'kobold', 'mech', 'undead', 'spirit']);

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
  if (o.tribe === 'spirit') {
    // SPIRIT HITS ARE STAGGERED (owner 2026-09-17: "each buff that goes out slightly offset"): the k-th ribbon of one
    // burst launches k × `spiritHitStaggerMs` after the first, and its landing cue and stat roll follow ITS ribbon.
    // A burst is the run of Spirit hits fired within `SPIRIT_BURST_WINDOW_MS` of each other (a board-wide buff
    // fires them in one frame; two separate casts a second apart are two bursts). Buff tuner → Sound.
    const cfg = getBuffFxConfig();
    const now = performance.now();
    spiritBurstIdx = now - spiritBurstAt <= SPIRIT_BURST_WINDOW_MS ? spiritBurstIdx + 1 : 0;
    spiritBurstAt = now;
    const stagger = spiritBurstIdx * Math.max(0, cfg.spiritHitStaggerMs);
    const fire = (): void => { playDef('tendril-trail-spirit', { source: o.source!, target: o.target }, { uids: o.uids }); };
    if (stagger > 0) window.setTimeout(fire, stagger); else fire();
    sfx.spiritTendril(stagger + TENDRIL_TRAIL_TRAVEL_MS + cfg.spiritSfxOffsetMs);
    return stagger + TENDRIL_TRAIL_TRAVEL_MS;
  }
  if (TENDRIL_TRIBES.has(o.tribe)) {
    playDef(`tendril-trail-${o.tribe}`, { source: o.source, target: o.target }, { uids: o.uids });
  } else {
    playDef('tendril-trail', { source: o.source, target: o.target }, { uids: o.uids });
  }
  return TENDRIL_TRAIL_TRAVEL_MS;
}
