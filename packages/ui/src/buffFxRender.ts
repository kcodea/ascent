import type { Tribe } from '@game/core';
import { playDef } from './fx/playDef';
import runeBuffTrail from './fx/defs/rune-buff-trail.json';
import tendrilTrailSpirit from './fx/defs/tendril-trail-spirit.json';
import { DESCEND_PRESETS, descendPreset } from './descendPresets';
import { getBuffFxConfig, tunedDescend } from './buffFxConfig';
import { sfx } from './sfx';

/**
 * The flight time of `rune-buff-trail`'s ribbon, read from the def itself rather than pinned here — the stat-badge
 * roll is scheduled to land when the ribbon ARRIVES, so retuning the ribbon's `travelMs` in the workbench moves
 * the roll with it and nothing has to be kept in sync by hand. The burst layer has its own (tiny) `travelMs`,
 * hence the primitive check. 210 is the authored value at the time of writing, kept only as a safety net.
 */
export const TENDRIL_TRAIL_TRAVEL_MS: number =
  runeBuffTrail.layers.find((l) => l.primitive === 'ribbon')?.travelMs ?? 210;

/**
 * THE one generic buff trail (owner 2026-11-13: *"i want to replace both with a single workbench effect"*). The gold
 * `rune-buff-trail` def replaced both the green generic `tendril-trail` and the procedural gold quest tendril
 * (`pixiFx.buffTendril` + its tuner), so a rune or quest reward, a rune's cast and a tribeless buffer all draw this.
 * Every play of it goes through here, so there is one literal call site.
 */
export function playRuneBuffTrail(
  source: { x: number; y: number },
  target: { x: number; y: number },
  opts: { uids?: { source?: string | null; target?: string | null }; intensity?: number } = {},
): void {
  // THE SOUND DOES NOT STACK (owner 2026-11-13: "the sound shouldnt stack"): a board-wide buff fires one trail per
  // unit in the same moment, and only the first of that burst carries the def's Sound layers. Same rule and same
  // dial as a spell's cast sound (`spellCastSfxGapMs`): a muted play does not move the clock, so trails slower than
  // the gap each ring.
  const sound = runeBuffTrailSoundAllowed();
  playDef('rune-buff-trail', { source, target }, {
    uids: opts.uids,
    ...(opts.intensity !== undefined && opts.intensity < 1 ? { intensity: opts.intensity } : {}),
    ...(sound ? {} : { muteSound: true }),
  });
}

let runeBuffTrailSoundAt = -Infinity;
/** May this trail sound? False inside `spellCastSfxGapMs` of the last trail that did. `now` is injectable for tests. */
export function runeBuffTrailSoundAllowed(now: number = performance.now()): boolean {
  if (now - runeBuffTrailSoundAt < getBuffFxConfig().spellCastSfxGapMs) return false;
  runeBuffTrailSoundAt = now;
  return true;
}

/** Tribes with a per-tribe `tendril-trail-<tribe>` variant (a palette-swap of the generic). `neutral` alone keeps
 *  the generic ribbon. `celestial` joined 2026-09-14 (owner report: Wishing Star drew the default) with a
 *  moonlit-periwinkle palette swap of the generic — a PLACEHOLDER for the owner to retune in the workbench. */
/**
 * When the SPIRIT ribbon's landing burst goes off, read from its own def: the first TARGET-anchored layer's `at`
 * (the burst + shockwave at 210 ms), NOT the ribbon's `travelMs` (170 — the ribbon arrives before the burst) and
 * not the generic def's timing. The landing cue and the stat roll are timed to THIS (owner 2026-09-17: "it should
 * play when the burst effect goes off"). Retuning the def in the workbench moves both with it.
 */
const SPIRIT_LANDING_MS: number = (() => {
  const target = tendrilTrailSpirit.layers.find((l) => l.anchor === 'target' && typeof l.at === 'number');
  return target?.at ?? tendrilTrailSpirit.layers.find((l) => l.primitive === 'ribbon')?.travelMs ?? TENDRIL_TRAIL_TRAVEL_MS;
})();

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
 * A LIVING source plays the owner-authored `rune-buff-trail` def (2026-11-13) — a ribbon streaming source→target
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
  /** Particle QUANTITY scale (`playDef`'s `intensity`, 0..1): a per-fire chain thins its tendrils' bursts so a long
   *  chain keeps about the particle load one summed beat had (R-DEMON-DMG-BEATS-02). Omitted = as authored. */
  intensity?: number;
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
    const fire = (): void => { playDef('tendril-trail-spirit', { source: o.source!, target: o.target }, { uids: o.uids, ...(o.intensity !== undefined && o.intensity < 1 ? { intensity: o.intensity } : {}) }); };
    if (stagger > 0) window.setTimeout(fire, stagger); else fire();
    sfx.spiritTendril(stagger + SPIRIT_LANDING_MS + cfg.spiritSfxOffsetMs);
    return stagger + SPIRIT_LANDING_MS;
  }
  if (TENDRIL_TRIBES.has(o.tribe)) {
    playDef(`tendril-trail-${o.tribe}`, { source: o.source, target: o.target }, { uids: o.uids, ...(o.intensity !== undefined && o.intensity < 1 ? { intensity: o.intensity } : {}) });
  } else {
    playRuneBuffTrail(o.source, o.target, { uids: o.uids, intensity: o.intensity });
  }
  return TENDRIL_TRAIL_TRAVEL_MS;
}
