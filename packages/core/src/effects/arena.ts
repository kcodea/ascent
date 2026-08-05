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
  /** Raise the run's Ruby power (+atk/+hp per future Ruby). Adapters own the ledger: combat routes through
   *  its carry-back channel (`gainRubyBonus`), the shop raises `rubyBonus` AND buffs Rubies already in hand —
   *  each phase's legacy bookkeeping, unchanged. The body passes GOLDEN-MULTIPLIED amounts; adapters add none. */
  grantRubyPower(attack: number, health: number): void;
  /** The Rubies sitting ON a body — each phase's own per-instance ledger (combat: the carried 'Ruby' buff
   *  snapshot plus mid-fight `rubyGain`; shop: the 'Ruby' entry in the buff breakdown). */
  rubyTallyOf(t: ArenaBody): { attack: number; health: number };
  /** Summon ONE token, optionally with a keyword and/or explicit stats. Returns the body (undefined = board
   *  full). Explicit stats: combat folds them into the summon snapshot; the shop labels the above-base share
   *  as a Ruby buff and fires its onRubyPlayed watchers — each phase's legacy bookkeeping. */
  summonToken(tokenId: string, opts?: { attack?: number; health?: number; keyword?: string }): ArenaBody | undefined;
  /** Play `per` Rubies on a body — each phase's own ritual: combat routes through `playRubyOn` (rubyBonus +
   *  Deepdelve multiplier + the target's onRubyPlayed listeners); the shop applies `(1+rubyBonus)×per` as a
   *  'Ruby' buff and fires its watchers. */
  playRubiesOn(t: ArenaBody, per: number): void;
  /** Rise (Reborn). Combat also reads the live `rebornAvailable` flag; the shop reads the keyword. */
  hasReborn(t: ArenaBody): boolean;
  grantReborn(t: ArenaBody): void;
  /** Does `t` belong to `tribe`? Adapters fold in tribe2 + universalTribe, each phase's own way. */
  isTribe(t: ArenaBody, tribe: string): boolean;
  /** Ruby STATS without the onRubyPlayed notification — the bounce primitive. The missing notification is
   *  the load-bearing no-rebounce guard: two adjacent Resonance Idols must not ping a Ruby forever. */
  gainRubyStats(t: ArenaBody, attack: number, health: number): void;
  /** The nearest living neighbours (left, right) of a body. */
  neighboursOf(t: ArenaBody): ArenaBody[];
  /** Raise the run's MAXIMUM Gold. Combat routes through its carry-back channel (and logs the maxGold
   *  event for the replay); the shop raises `maxEmbers` directly. */
  grantMaxGold(amount: number): void;
  /** Is this body a Celestial? (A card-definition read; adapters own their card index access.) */
  isCelestial(t: ArenaBody): boolean;
  /** Is this body an Imp? */
  isImp(t: ArenaBody): boolean;
  /** Raise the RUN-WIDE Imp aura (+atk/+hp on every Imp, present and future). Each adapter runs its whole
   *  legacy ritual: the shop's `buffImpsRunWide` (board + hand + the persistent aura); combat buffs the
   *  living Imps AND carries the aura back via `grantImpBuff` — so the body only states the amounts. */
  grantImpAura(attack: number, health: number): void;
  /** The current Imp aura (combat: the side's live aura; shop: `RunState.impBuff`). */
  impAura(): { attack: number; health: number };
  /** Echoes (Deathrattles) triggered so far — combat: the side's run-wide base + this fight's; shop: the
   *  run tally. Grim scales off this. */
  deathrattleTally(): number;
  /** Register a rest-of-combat tribe aura (friends of `tribe` summoned LATER also gain it). A shop no-op:
   *  there is no rest-of-combat in a shop, and the legacy shop half never registered one. */
  addTribeAura(tribe: string, attack: number, health: number): void;
  /** Permanently buff a CARD TYPE run-wide (every copy: board, hand, future). Each adapter runs its whole
   *  legacy ritual — combat: the carry-back channel PLUS live-buffing copies on the board this fight; shop:
   *  `buffCardTypeRunWide` (which already covers board + hand itself — the body must NOT re-loop). */
  grantCardTypeBuff(cardId: string, attack: number, health: number): void;
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

  /** Faultline Scrapper / Alchemist Brisbane — Echo: your Rubies gain +atk/+hp (golden doubles). */
  deathrattleRubyStatGain(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    arena.grantRubyPower(
      (typeof params.attack === 'number' ? params.attack : 1) * g,
      (typeof params.health === 'number' ? params.health : 1) * g,
    );
  },

  /** Gemheart Carver — Echo: summon a Shard at 1/1 PLUS the Rubies on this minion. GOLDEN = ONE Shard at
   *  double stats (owner ruling 2026-08-04) — the shop half used to summon two at base instead; retired. */
  deathrattleSummonRubyStats(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const t = arena.rubyTallyOf(arena.self);
    const id = typeof params.tokenId === 'string' && params.tokenId ? params.tokenId : 'gemheart-shard';
    arena.summonToken(id, { attack: (1 + t.attack) * g, health: (1 + t.health) * g });
  },

  /** Geode Guardian — Echo: summon `count` Golems (default 2, NOT golden-scaled — owner: a Gilded copy still
   *  summons two) with Taunt, and play `rubies × golden` Rubies on each as it lands. */
  deathrattleSummonGolemsWithRuby(arena: EffectArena, params: Record<string, unknown>): void {
    const per = (typeof params.rubies === 'number' ? params.rubies : 1) * (arena.self.golden ? 2 : 1);
    const count = typeof params.count === 'number' ? params.count : 2;
    for (let i = 0; i < count; i++) {
      const golem = arena.summonToken('gemheart-shard', { keyword: 'T' });
      if (!golem) break; // board full
      arena.playRubiesOn(golem, per);
    }
  },

  /** Mumi — Echo: give a friendly minion (of `tribe`, if set) RISE; golden grants twice. RANDOM in both
   *  phases (standing owner ruling 2026-08-04, from Trickster: the shop's highest-Attack pick was a
   *  pre-cursor-RNG workaround and is retired across the class). */
  deathrattleGrantReborn(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    const rng = arena.rng();
    for (let i = 0; i < (arena.self.golden ? 2 : 1); i++) {
      const pool = arena.friends().filter((m) =>
        m.uid !== arena.self.uid && !arena.hasReborn(m) && (!tribe || arena.isTribe(m, tribe)));
      if (pool.length === 0) return;
      arena.grantReborn(pool[rng.int(pool.length)]!);
    }
  },

  /** Echo: give a friendly minion WARD; golden grants twice (the shop half used to grant once AND pick the
   *  carry — both retired under the same standing ruling; golden parity follows the combat reading). */
  deathrattleGrantShield(arena: EffectArena, _params: Record<string, unknown>): void {
    const rng = arena.rng();
    for (let i = 0; i < (arena.self.golden ? 2 : 1); i++) {
      const pool = arena.friends().filter((m) => m.uid !== arena.self.uid && !arena.hasShield(m));
      if (pool.length === 0) return;
      arena.grantShield(pool[rng.int(pool.length)]!);
    }
  },

  /** Resonance Idol — a Ruby played on this bounces the same stats onward (golden: `goldenReps` per target).
   *  `random: N` (the 2026-07-27 rework — position no longer gates the payoff) bounces to N DISTINCT random
   *  friends; without it, to the two neighbours. The bounce uses `gainRubyStats` (no watcher notification) so
   *  a bounce can never re-trigger a bounce.
   *
   *  UNIFICATION FIXED REAL DRIFT: the rework only ever landed in the shop half — combat ignored `random` and
   *  kept bouncing to neighbours, so the same card behaved differently by phase. One body now implements the
   *  reworked design everywhere. The Ruby amounts arrive via params (`rubyAttack`/`rubyHealth`, merged from
   *  the dispatch payload by the wrappers). */
  rubyPlayedBounce(arena: EffectArena, params: Record<string, unknown>): void {
    const a = typeof params.rubyAttack === 'number' ? params.rubyAttack : 0;
    const h = typeof params.rubyHealth === 'number' ? params.rubyHealth : 0;
    if (a <= 0 && h <= 0) return;
    const reps = arena.self.golden ? (typeof params.goldenReps === 'number' ? params.goldenReps : 2) : 1;
    const randomN = typeof params.random === 'number' ? params.random : 0;
    if (randomN > 0) {
      const rng = arena.rng();
      const pool = arena.friends().filter((m) => m.uid !== arena.self.uid);
      for (let i = 0; i < randomN && pool.length > 0; i++) {
        const t = pool.splice(rng.int(pool.length), 1)[0]!;
        for (let r = 0; r < reps; r++) arena.gainRubyStats(t, a, h);
      }
      return;
    }
    for (const adj of arena.neighboursOf(arena.self)) {
      for (let r = 0; r < reps; r++) arena.gainRubyStats(adj, a, h);
    }
  },

  /** Bone Taxer — Echo: raise your maximum Gold by `amount` (golden doubles). */
  deathrattleMaxGold(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantMaxGold((typeof params.amount === 'number' ? params.amount : 1) * (arena.self.golden ? 2 : 1));
  },

  /** Equinox Duelist — Echo: buff your OTHER Celestials +atk/+hp (golden doubles). */
  deathrattleBuffCelestials(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 0) * g;
    const h = (typeof params.health === 'number' ? params.health : 0) * g;
    if (a <= 0 && h <= 0) return;
    for (const f of arena.friends()) {
      if (f.uid !== arena.self.uid && arena.isCelestial(f)) arena.buff(f, a, h);
    }
  },

  /** Imp Overseer — Echo: your Imps gain +atk/+hp, run-wide and permanent (golden doubles). The adapters own
   *  the two rituals entirely; the body is the sentence. */
  deathrattleBuffImps(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    arena.grantImpAura(
      (typeof params.attack === 'number' ? params.attack : 2) * g,
      (typeof params.health === 'number' ? params.health : 3) * g,
    );
  },

  /** Herald of the Divide — whenever a Battlecry fires on your side, THIS body grows (golden doubles). */
  onBattlecryBuffSelf(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    arena.buff(arena.self,
      (typeof params.attack === 'number' ? params.attack : 1) * g,
      (typeof params.health === 'number' ? params.health : 1) * g);
  },

  /** Chef Raag — Echo: buff your whole board by the run's Imp aura, FLOORED at +1/+1 (owner 2026-07-21: with
   *  no aura built up it still pays a baseline). Golden doubles. */
  deathrattleBuffAllByImpAura(arena: EffectArena, _params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const imp = arena.impAura();
    const a = Math.max(1, imp.attack) * g;
    const h = Math.max(1, imp.health) * g;
    for (const f of arena.friends()) arena.buff(f, a, h);
  },

  /** Grim — Echo: your minions of `tribe` gain +N/+N where N = Echoes triggered × `per` (golden doubles),
   *  plus a rest-of-combat aura so later summons inherit it (a shop no-op by design). */
  deathrattleBuffTribeByTally(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = typeof params.tribe === 'string' && params.tribe ? params.tribe : 'any';
    const amount = arena.deathrattleTally()
      * (typeof params.per === 'number' ? params.per : 1)
      * (arena.self.golden ? 2 : 1);
    if (amount <= 0) return;
    arena.addTribeAura(tribe, amount, amount);
    for (const f of arena.friends()) {
      if (f.uid !== arena.self.uid && (tribe === 'any' || arena.isTribe(f, tribe))) arena.buff(f, amount, amount);
    }
  },

  /** Echo: permanently buff every copy of a card type, run-wide (golden doubles). `cardId` defaults to
   *  the dying minion's own type. */
  deathrattleBuffCardTypeRunWide(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const cardId = typeof params.cardId === 'string' && params.cardId ? params.cardId : arena.self.cardId;
    arena.grantCardTypeBuff(cardId,
      (typeof params.attack === 'number' ? params.attack : 1) * g,
      (typeof params.health === 'number' ? params.health : 1) * g);
  },

  /** Errand Fiend / Imp Wrangler — summon `count` Imps (golden doubles), each optionally keyworded and
   *  buffed as it lands. GOLDEN DOUBLES THE PER-IMP BUFF TOO — Errand Fiend's goldenText prints "+2/+4",
   *  which the combat half honoured and the shop half silently didn't (drift fixed by unification). */
  summonImps(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const kw = typeof params.keyword === 'string' && params.keyword ? params.keyword : undefined;
    const a = (typeof params.attack === 'number' ? params.attack : 0) * g;
    const h = (typeof params.health === 'number' ? params.health : 0) * g;
    const count = (typeof params.count === 'number' ? params.count : 1) * g;
    for (let i = 0; i < count; i++) {
      const made = arena.summonToken('impscrap', kw ? { keyword: kw } : undefined);
      if (!made) break; // board full
      if (a > 0 || h > 0) arena.buff(made, a, h);
    }
  },
} as const;
