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
    // Metadata fields below are copied verbatim from SceneBuilder.setEnemies. Traced each one against what a
    // SERVED board (staged via `servedBoards`, read verbatim by `nextOpponent`/`opponentBoard`, never through
    // matchmaking/`pickOpponent`) actually reads at fight time, so a future edit doesn't nervously "fix" one of
    // these into breaking the harness:
    //  - heroId: 'warden' — read once, in `opponentBoard` (packages/sim/src/opponents.ts), for a
    //    heroId === 'soren' special case (Soren's Reclaim arms a Start-of-Combat resummon on one enemy
    //    minion). 'warden' has no such branch, so this is INERT — chosen specifically because Warden has no
    //    served-board hero-power effect to accidentally arm.
    //  - resolve: 30 — DISPLAY-ONLY. `OpponentFrame.tsx` renders `snap.resolve` on the opponent card; combat
    //    resolution reads the RUN's own `s.resolve` (decremented by `playerDamage` in reducer.ts), never the
    //    served board's `resolve` field. Inert for fight outcome.
    //  - tier: 7 — NOT inert. `reducer.ts` maps `served.tier` into `enemyState.tier` (`CombatSideState.tier`),
    //    and `simulate.ts` adds it directly into `playerDamage` on a loss: `enemyState.tier + Σ(survivor
    //    tiers)`. Changing this number changes how much Resolve a lost harness fight would cost. 7 (the max
    //    tavern tier) is the existing SceneBuilder value; kept as-is for parity, but a reviewer changing it
    //    "for consistency" WOULD change loss-damage math.
    //  - threat: 'glass' — INERT. Grepped every read of a snapshot's `.threat`; nothing reads
    //    `snap.threat`/`served.threat` anywhere — only the RUN's own live `s.threat`/`run.threat` (used to
    //    build the procedural fallback enemy and for the run's own threat badge). The field exists on the
    //    type for provenance/shape parity only; unused downstream for a served board.
    //  - seed: 1 — INERT for the fight. Combat seeds itself from the RUN's `s.seed` mixed with wave/tag
    //    (`mixSeed(s.seed, s.wave, ...)`); `opponentBoard` never reads `snap.seed`. It exists for pool
    //    provenance/dedup (`synthesize.ts`) and replay reconstruction of the run that captured a board — moot
    //    for a harness board that's never captured from a real run.
    //  - origin: 'self' — INERT for a pinned/served board. `origin` is only consulted by `pickOpponent`
    //    (packages/sim/src/opponents.ts) when selecting a board OUT OF THE POOL; a harness board is pinned
    //    directly into `servedBoards` and read verbatim by `nextOpponent`, bypassing `pickOpponent` entirely.
    heroId: 'warden',
    resolve: 30,
    tier: 7,
    triples: 0,
    tribes: [],
    threat: 'glass',
    // `power` is documented on `BoardSnapshot` as "Σ(attack + health) over the board", which `health * count`
    // only equals when attack === health. This mirrors SceneBuilder.setEnemies's `power: hp * n` verbatim —
    // deliberately kept wrong-but-consistent rather than fixed here alone, which would make the two diverge
    // for real. Inert either way: `power` drives opponent-POOL strength matching (`pickOpponent`/rating), and
    // a harness board is never served through that pool — it's pinned directly. Fix both call sites together
    // if this is ever corrected.
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
