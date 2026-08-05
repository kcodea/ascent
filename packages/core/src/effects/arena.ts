import type { Rng } from '../rng';

/**
 * ── EFFECT ARENA (Step 1 spike — see docs/effect-arena-spec.md) ────────────────────────────────────────
 *
 * ONE implementation per effect, callable from either phase. An effect written against `EffectArena` runs in
 * combat through a `CombatContext`-backed adapter and in the shop through a `RunState`-backed adapter — the
 * same body, so the two phases can never drift apart and no disruptor card ever needs per-effect wiring.
 *
 * This file starts deliberately SMALL: the Step-1 RNG spike migrates exactly one rolling effect
 * (`deathrattleGrantWardRandom`) to prove the load-bearing property — that a migrated effect draws the same
 * random numbers, in the same order, in both phases, so pinned replays, `servedBoards` and the golden tests
 * all survive. Step 2 grows the interface (buff/summon/announce + the defer/no-op probes); nothing here is
 * final vocabulary.
 *
 * RNG contract: `rng()` returns the PHASE'S OWN stream — combat hands over its threaded instance, the shop
 * adapter wraps `state.rngCursor` (create → draw → write back per call; mulberry32's state round-trips
 * exactly, so per-call reconstruction is the same stream as one long-lived instance). An effect must draw
 * the same COUNT in the same ORDER as the implementations it replaces — that is what the spike verifies.
 */

/** The narrow view of a body that both phases' minion types already satisfy structurally —
 *  `Minion` (combat) and `BoardCard` (shop) are passed through UNWRAPPED; adapters cast back internally.
 *  `keywords` is readonly here: bodies never mutate state directly, only through arena verbs. */
export interface ArenaBody {
  uid: string;
  cardId: string;
  attack: number;
  health: number;
  keywords: readonly string[];
  golden?: boolean;
}

export interface EffectArena {
  readonly phase: 'combat' | 'shop';
  /** The minion whose effect is firing. May be dead in combat (an Echo) — adapters don't filter it out of
   *  `friends()`; effect bodies exclude it by uid where the effect's text says "other". */
  self: ArenaBody;
  /** Living allies in BOARD ORDER (combat: `ctx.living(side)`; shop: `state.board`). Order is load-bearing:
   *  random picks index into this list, and both legacy implementations indexed board-ordered pools. */
  friends(): ArenaBody[];
  /** Whether `t` currently has a Ward. Phase-specific on purpose: combat reads the LIVE `divineShield` flag
   *  (a broken shield can be re-granted mid-fight), the shop reads the `DS` keyword. */
  hasShield(t: ArenaBody): boolean;
  grantShield(t: ArenaBody): void;
  /** The phase's own random stream. See the RNG contract above. */
  rng(): Rng;
}

/**
 * The shared effect bodies. Keyed by the same `do` ids as the legacy registries, so the wrappers in
 * `FACTORIES` / `RECRUIT_FACTORIES` are one-liners and the ratchet test (Step 2) can diff coverage.
 */
export const ARENA_EFFECTS = {
  /** Lastlight — Echo: give `count` friendly minions Ward (golden doubles). Distinct targets, drawn one
   *  `rng.int` per grant from a shrinking board-ordered pool — the EXACT draw pattern of both legacy halves
   *  (combat's `rng.pick` + splice and recruit's `rng.int` + splice are the same sequence). */
  deathrattleGrantWardRandom(arena: EffectArena, params: Record<string, unknown>): void {
    const count = typeof params.count === 'number' ? params.count : 2;
    const pool = arena.friends().filter((m) => m.uid !== arena.self.uid && !arena.hasShield(m));
    let n = count * (arena.self.golden ? 2 : 1);
    const rng = arena.rng();
    while (n > 0 && pool.length > 0) {
      const target = pool.splice(rng.int(pool.length), 1)[0]!;
      arena.grantShield(target);
      n--;
    }
  },
} as const;
