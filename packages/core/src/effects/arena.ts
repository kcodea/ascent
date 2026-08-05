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
  /** Sergeant's per-instance HP-grant accrual — carried on both phases' bodies already. */
  hpGrantBonus?: number;
  /** Combat carries a separate max; the shop's printed health IS its max. Bodies read `maxHealth ?? health`. */
  maxHealth?: number;
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
  /** Buff a body. The SOURCE label is the adapter's job — combat attributes by uid (the event log's format),
   *  the shop by display name (the inspect-breakdown's format) — so one body serves both ledgers unchanged. */
  buff(t: ArenaBody, attack: number, health: number): void;
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

  /** Deathrattle: buff ALL friends +atk/+hp (golden doubles). `friends()` already encodes each phase's own
   *  membership rule (combat: the living — a dead self is naturally absent; shop: the whole board, self
   *  included), so the body states the sentence once and the adapters keep their legacy semantics exactly. */
  deathrattleBuffAll(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 1) * g;
    const h = (typeof params.health === 'number' ? params.health : 1) * g;
    for (const f of arena.friends()) arena.buff(f, a, h);
  },

  /** Sergeant — Echo: your minions gain +Health (golden doubles), plus this instance's accrued
   *  `hpGrantBonus`. The shop half's `hp <= 0` guard is kept — unreachable in content (base 2), harmless. */
  deathrattleBuffAllHealth(arena: EffectArena, params: Record<string, unknown>): void {
    const hp = (typeof params.health === 'number' ? params.health : 2) * (arena.self.golden ? 2 : 1)
      + (arena.self.hpGrantBonus ?? 0);
    if (hp <= 0) return;
    for (const f of arena.friends()) arena.buff(f, 0, hp);
  },

  /** Trickster — Echo: give `count` random OTHER friends this minion's Health (golden doubles the grants).
   *  RANDOM IN BOTH PHASES (owner ruling 2026-08-04) — the shop half used to pick the highest-Attack carry,
   *  a workaround from before the cursor RNG existed; "random = random in both shop and in combat". Targets
   *  may repeat across grants (the legacy combat behaviour: the pool is re-drawn per grant, not spliced). */
  deathrattleGiveHealth(arena: EffectArena, params: Record<string, unknown>): void {
    const hp = arena.self.maxHealth ?? arena.self.health;
    if (hp <= 0) return;
    const count = (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1);
    const rng = arena.rng();
    for (let i = 0; i < count; i++) {
      const pool = arena.friends().filter((m) => m.uid !== arena.self.uid);
      if (pool.length === 0) break;
      arena.buff(pool[rng.int(pool.length)]!, 0, hp);
    }
  },
} as const;
