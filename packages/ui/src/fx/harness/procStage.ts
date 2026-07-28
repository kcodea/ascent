import type { BoardSnapshot } from '@game/sim';
import type { Keyword } from '@game/core';

/**
 * The staged opponent for a harness fight, as DATA.
 *
 * `SceneBuilder.setEnemies` does the same job as a closure over its `mutate` helper, which makes the
 * clamping rules untestable. This is the pure half: the caller applies it to the store.
 *
 * Sandbags rather than a real pooled opponent because the harness needs a fight it can re-run identically
 * and tune the LENGTH of — more health means more beats, which is what makes a periodic proc (every fourth
 * attack, say) actually land before the fight ends.
 */
export interface SandbagSpec {
  count: number;
  hp: number;
  attack: number;
}

/** Published so the UI's slider bounds and the builder's clamps cannot drift apart. */
export const SANDBAG_LIMITS = { maxCount: 7, maxHp: 9999, maxAttack: 99 } as const;

const clamp = (v: number, lo: number, hi: number): number =>
  !Number.isFinite(v) ? lo : Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * The board to pin at `wave`. Combat reads a served board verbatim, so this is exactly what will be fought.
 *
 * Count and health floor at 1 — a board of nothing, or of corpses, ends combat instantly and the harness
 * would then report "no moments" for a card that is working perfectly, which is the confusing-failure case
 * this whole subsystem keeps trying to eliminate. Attack floors at 0, which is legal and useful: a punching
 * bag that never kills you lets a long fight run to completion.
 */
export function sandbagBoard(wave: number, spec: SandbagSpec): BoardSnapshot {
  const count = clamp(spec.count, 1, SANDBAG_LIMITS.maxCount);
  const health = clamp(spec.hp, 1, SANDBAG_LIMITS.maxHp);
  const attack = clamp(spec.attack, 0, SANDBAG_LIMITS.maxAttack);
  return {
    v: 1,
    wave,
    heroId: 'warden',
    resolve: 30,
    tier: 7,
    triples: 0,
    tribes: [],
    threat: 'glass',
    power: health * count,
    minions: Array.from({ length: count }, () => ({
      cardId: 'sandbag',
      attack,
      health,
      keywords: [] as Keyword[],
    })),
    seed: 1,
    origin: 'self',
  };
}
