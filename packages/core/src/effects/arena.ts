import type { Rng } from '../rng';
import { ALE_IDS } from '../types';

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
  /** Choose One: which branch this instance became (display + gating). */
  chosenOption?: number;
  /** The per-instance improve tally several cards share (Guel / Spirit Pup / Groveweaver / Kennelmaster). */
  spellProgress?: number;
  /** The per-instance summon-accrual tally (Pack Leader / Mama Bear / the asym buffers). */
  summonBonus?: number;
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
  summonToken(tokenId: string, opts?: { attack?: number; health?: number; keyword?: string; keywords?: readonly string[]; golden?: boolean; charge?: boolean; rubyLabel?: boolean }): ArenaBody | undefined;
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
  /** Is this body Fodder (the FD keyword on its printed card)? */
  isFodder(t: ArenaBody): boolean;
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
  /** Permanently raise the Undead ATTACK aura, everywhere (board + hand + future copies). Whole-ritual per
   *  adapter: combat live-buffs the Undead on board AND carries back via `grantUndeadBuyAtk`; the shop runs
   *  `buffUndeadAttackEverywhere`. The body only states the amount. */
  grantUndeadAttackAura(attack: number): void;
  /** The REAL tribes of a body (non-neutral, both slots). */
  tribesOf(t: ArenaBody): string[];
  /** Paragon's all-type flag. */
  isUniversalTribe(t: ArenaBody): boolean;
  /** Rune of Mastery reps — how many times an Improve tick applies (2 under the rune, else 1). */
  improveReps(): number;
  /** Rune of the Matriarch reps (2 with the rune, else 1). The shop adapter returns 1 — the legacy shop
   *  halves never applied Matriarch, and that behaviour is preserved until ruled otherwise. */
  matriarchReps(): number;
  /** Announce a spellProgress tick (the live countdown). A combat log event; a shop no-op. */
  logSpellProgress(amount: number): void;
  /** Announce an Improve tick (the improve pop). A combat log event; a shop no-op. */
  logImprove(amount: number): void;
  /** Buff a body PERMANENTLY. A shop buff is permanent by nature (plain `buff`); in combat the gain is also
   *  recorded into the carry-back (`permaGain`) regardless of Engrave — Flowing Monk's gift keeps. */
  buffPermanent(t: ArenaBody, attack: number, health: number): void;
  /** Shop spells cast this turn, for THIS side (combat reads the side's captured value). */
  spellsThisTurn(): number;
  /** Grant `count` copies of a NAMED card to hand. Combat rides `grantToHand` (announced + flown in the
   *  replay); the shop conjures (run-buff bake + hand cap). */
  grantNamedCard(cardId: string, count: number): void;
  /** Grant `count` random Shop spells. Each phase's legacy pick: combat's `grantRandomSpell` channel resolves
   *  at settle (≤ tavern tier; `exactTier` is not expressible there and keeps its legacy shop-only meaning);
   *  the shop conjures from the pinned pool's spells. */
  grantRandomSpells(count: number, exactTier?: number): void;
  /** Grant `count` random cards matching `pred` from the run's PINNED pool to the player's hand. Each phase's
   *  whole legacy ritual: combat picks one-per-grant off its threaded rng and rides `grantToHand` (the card
   *  flies to hand in the replay); the shop conjures via `conjureToHand` (cursor picks + run-buff bake +
   *  hand cap). `pred` sees the CardDef; write the FULL legacy filter in the body — clauses a phase's pool
   *  already excludes are harmless no-ops there. */
  grantRandomFromPool(pred: (card: { id: string; keywords: readonly string[]; token?: boolean; spell?: boolean }) => boolean, count: number): void;
  /** Raise the run-wide FODDER enchant (the Fodder card type, everywhere). Whole-ritual per adapter. */
  grantFodderAura(attack: number, health: number): void;
  /** Bane's Existence's Demon-widen, as one ritual: the shop buffs every Demon you have (board + hand); combat
   *  permanently buffs the living Demons (the carry-back keeps it — hand copies are unreachable mid-fight and
   *  pick the enchant up as printed run-wide state). No-op when the quest isn't armed. */
  applyBaneDemonWiden(): void;
  /** Remove a body's Echo (onDeath) effects — the no-chain guard for "summon a copy WITHOUT the Echo".
   *  Combat filters the instance's live effects list; a shop copy carries no per-instance effect list, so the
   *  adapter marks the card (`echoStripped`) and the shop's Echo dispatch skips marked bodies. */
  stripEchoes(t: ArenaBody): void;
  /** Stamp Karwind's pulse FX on a body — shop-side bookkeeping (`karwindFlash`); a combat no-op (combat FX
   *  ride the buff events). */
  stampKarwindFlash(t: ArenaBody): void;
  /** A display name for a body (combat: the live minion's; shop: the card def's). */
  nameOf(t: ArenaBody): string;
  /** Narrate a beat into the combat log (`sc` text). A shop no-op — the shop has FX, not narration. */
  narrate(text: string): void;
  /** The run's active tribes — the generation-pool filter for tier/tribe-scoped random grants. */
  activeTribes(): string[];
  /** Deal `amount` to every living body — combat: BOTH sides; shop: YOUR board (there is no enemy), and a
   *  body taken to 0 dies there too — removed, its own Echo firing (owner ruling 2026-08-04: "Blaster should
   *  still deal dmg to your board if borrowed and played"). */
  damageAll(amount: number): void;
  /** Cast the named tribe-aura spell as a REAL cast — it counts for every per-spell watcher. Whole-ritual per
   *  phase: the shop casts the actual card through its full pipeline (`castSpell` — permanent aura + cast
   *  bookkeeping); combat counts the cast, applies the rest-of-fight tribe aura with spell power folded in,
   *  and narrates (the pre-existing phase asymmetry — shop permanent, combat fight-long — is each half's
   *  legacy behaviour, preserved, not invented here). */
  castTribeAttackSpell(tribe: string, amount: number, spellId: string): void;
  /** Grant an arbitrary keyword (combat also arms the live flags — DS → divineShield, R → rebornAvailable —
   *  and logs the keyword event so the pill appears; the shop appends to the card's keywords). */
  grantKeywordTo(t: ArenaBody, kw: string): void;
  /** Scrap Herald's whole ritual: buff every current Magnetic (combat: living M-keyword bodies; shop: board
   *  + hand) AND stack the run's `magneticBuyAtk/Hp` so future Magnetics carry it (combat carries back —
   *  settle stacks + buffs the run's Magnetics). */
  grantMagneticAura(attack: number, health: number): void;
  /** Elderhorn's extra BEAST trigger fires (`hunt` → Rally/Slaughter, `ritual` → Echo), permanent. In combat
   *  the gain also reads live for the rest of the fight. */
  grantBeastExtra(hunt: number, ritual: number): void;
  /** Permanently raise run-wide spell power (combat: the carry-back channel; shop: `spellBonus`). */
  grantSpellPower(attack: number, health: number): void;
  /** The card's printed `targetTribe` restriction, if any (a card-definition read). */
  targetTribe(): string | undefined;
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
    arena.summonToken(id, { attack: (1 + t.attack) * g, health: (1 + t.health) * g, rubyLabel: true });
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

  /** Whenever you cast a Shop spell: your minions gain +atk/+hp (golden doubles). */
  spellCastBuffAll(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 1) * g;
    const h = (typeof params.health === 'number' ? params.health : 0) * g;
    if (a === 0 && h === 0) return;
    // Optional `tribe` filter (Earthbreaker: Dragons only) — omitted → buffs the whole side, as before.
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    for (const f of arena.friends()) if (!tribe || arena.isTribe(f, tribe)) arena.buff(f, a, h);
  },

  /** Deathswarmer's spell-cast twin: your Undead gain +Attack EVERYWHERE, permanently (golden doubles). */
  spellCastBuffUndeadAttack(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantUndeadAttackAura((typeof params.attack === 'number' ? params.attack : 2) * (arena.self.golden ? 2 : 1));
  },

  /** Runekeg — whenever you cast a Shop spell: give `count` random minions of `tribe` +atk/+hp (golden
   *  doubles; `excludeSelf` for "other"). Runebloom Matriarch used to share this and repeat under Rune of the
   *  Matriarch; its 2026-08-07 rework moved it to `scGrantSpellCastExtra`, which now carries that rune. */
  onSpellCastBuffRandomTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    const a = (typeof params.attack === 'number' ? params.attack : 3) * g;
    const h = (typeof params.health === 'number' ? params.health : 3) * g;
    if (a <= 0 && h <= 0) return;
    const rng = arena.rng();
    {
      const pool = arena.friends().filter((m) =>
        (!tribe || arena.isTribe(m, tribe)) && !(params.excludeSelf && m.uid === arena.self.uid));
      if (pool.length === 0) return;
      const want = Math.min(typeof params.count === 'number' ? params.count : 3, pool.length);
      for (let i = 0; i < want; i++) arena.buff(pool.splice(rng.int(pool.length), 1)[0]!, a, h);
    }
  },

  /** Fatecarver — each Shop spell buffs ONE minion of each type, walking the board in order (seating steers
   *  who benefits). A Paragon takes its own slot, not every tribe's. Golden doubles. */
  onSpellCastBuffOnePerTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 2) * g;
    const h = (typeof params.health === 'number' ? params.health : 2) * g;
    if (a <= 0 && h <= 0) return;
    const seen = new Set<string>();
    for (const f of arena.friends()) {
      if (arena.isUniversalTribe(f)) { arena.buff(f, a, h); continue; }
      const tribes = arena.tribesOf(f);
      if (tribes.length === 0) continue;
      if (tribes.every((t) => seen.has(t))) continue;
      for (const t of tribes) seen.add(t);
      arena.buff(f, a, h);
    }
  },

  /** The asym on-summon buffer: when a friend of `tribe` is played/summoned beside this, buff THE ARRIVER by
   *  (base + this instance's `summonBonus`) × golden. The arriver rides `params.arriver` (merged by the
   *  wrappers from the dispatch payload). */
  summonBuffTribeAsym(arena: EffectArena, params: Record<string, unknown>): void {
    const arriver = params.arriver as ArenaBody | undefined;
    if (!arriver || arriver.uid === arena.self.uid) return;
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    if (tribe && !arena.isTribe(arriver, tribe)) return;
    const g = arena.self.golden ? 2 : 1;
    const bonus = arena.self.summonBonus ?? 0;
    const a = ((typeof params.attack === 'number' ? params.attack : 2) + bonus) * g;
    const h = ((typeof params.health === 'number' ? params.health : 4) + bonus) * g;
    if (a <= 0 && h <= 0) return;
    arena.buff(arriver, a, h);
  },

  /** Spirit Pup's improve tick: each Shop spell advances this instance's `spellProgress` (× Rune of Mastery). */
  spellCastImproveSelf(arena: EffectArena, _params: Record<string, unknown>): void {
    arena.self.spellProgress = (arena.self.spellProgress ?? 0) + arena.improveReps();
    arena.logSpellProgress(arena.self.spellProgress);
  },

  /** Archmagus Guel — each Shop spell: give `count` random OTHER friends +atk/+hp, improving +1/+1 per 4
   *  spells cast while THIS instance is on the board (tick first, × Rune of Mastery; golden doubles the
   *  grant). Distinct targets per cast. */
  spellCastBuffOthers(arena: EffectArena, params: Record<string, unknown>): void {
    arena.self.spellProgress = (arena.self.spellProgress ?? 0) + arena.improveReps();
    arena.logSpellProgress(arena.self.spellProgress);
    const g = arena.self.golden ? 2 : 1;
    const step = Math.floor(arena.self.spellProgress / 4);
    const a = ((typeof params.attack === 'number' ? params.attack : 1) + step) * g;
    const h = ((typeof params.health === 'number' ? params.health : 1) + step) * g;
    const pool = arena.friends().filter((m) => m.uid !== arena.self.uid);
    const rng = arena.rng();
    const want = typeof params.count === 'number' ? params.count : 2;
    for (let i = 0; i < want && pool.length > 0; i++) {
      arena.buff(pool.splice(rng.int(pool.length), 1)[0]!, a, h);
    }
  },

  /** Thunderous Sovereign's improve half: each Shop spell accrues `step` into this instance's `summonBonus`
   *  (× Rune of Mastery), which its Start-of-Combat grant spends. */
  onSpellCastImproveSummon(arena: EffectArena, params: Record<string, unknown>): void {
    const amount = (typeof params.step === 'number' ? params.step : 1) * arena.improveReps();
    arena.self.summonBonus = (arena.self.summonBonus ?? 0) + amount;
    arena.logImprove(amount);
  },

  /** Spirit Worgen — when a Beast/Dragon is played beside it, gain base × (1 + spells this turn) × golden.
   *  THE SHOP FORMULA IS THE CARD (owner ruling 2026-08-04 + the printed text: "+3/+3, improves by +3/+3 per
   *  Shop spell" IS base×(1+spells)); the combat half's additive (base + spells) is retired. The arriver
   *  rides `params.arriver`; the body only checks its tribes. */
  summonBuffSelfTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const arriver = params.arriver as ArenaBody | undefined;
    if (!arriver || arriver.uid === arena.self.uid) return;
    const tribes = Array.isArray(params.tribes) ? (params.tribes as string[]) : [];
    if (!tribes.some((t) => arena.isTribe(arriver, t))) return;
    const spells = arena.spellsThisTurn() * arena.improveReps();
    const g = arena.self.golden ? 2 : 1;
    arena.buff(arena.self,
      (typeof params.attack === 'number' ? params.attack : 3) * g * (1 + spells),
      (typeof params.health === 'number' ? params.health : 3) * g * (1 + spells));
  },

  /** Hunter — when THIS minion's Attack rises: buff your OTHER minions by (base + accrual) × golden, then
   *  grow the accrual by base (× Rune of Mastery). THE SHOP FORMULA IS THE CARD (owner ruling 2026-08-04);
   *  combat's stepped ×(1 + floor(fires/every)) is retired, and `every` with it. Re-entrancy guards (our own
   *  +Attack grant must not re-fire this) stay in the wrappers. */
  onGainAttackBuffImproving(arena: EffectArena, params: Record<string, unknown>): void {
    const base = typeof params.attack === 'number' ? params.attack : 1;
    const m = (base + (arena.self.summonBonus ?? 0)) * (arena.self.golden ? 2 : 1);
    if (m > 0) {
      for (const f of arena.friends()) if (f.uid !== arena.self.uid) arena.buff(f, m, m);
    }
    const tick = base * arena.improveReps();
    arena.self.summonBonus = (arena.self.summonBonus ?? 0) + tick;
    arena.logImprove(tick); // the live-text countdown ticks mid-fight
  },

  /** Echo: summon `count` copies of a token (golden doubles the count UNLESS `fixed`; `goldenTokens` gilds
   *  the tokens instead — Manasaber's cubs; optional `keyword` rides the summon snapshot). UNIFIED TO THE
   *  COMBAT READING (owner confirm 2026-08-04): the shop half was missing `fixed`/`goldenTokens`, so a golden
   *  Imp King's shop Echo summoned 4 plain tokens where the card means 2. */
  deathrattleSummon(arena: EffectArena, params: Record<string, unknown>): void {
    const id = typeof params.tokenId === 'string' ? params.tokenId : '';
    if (!id) return;
    const total = (typeof params.count === 'number' ? params.count : 1)
      * (params.fixed ? 1 : arena.self.golden ? 2 : 1);
    const golden = !!params.goldenTokens && arena.self.golden === true;
    const kw = typeof params.keyword === 'string' && params.keyword ? params.keyword : undefined;
    for (let i = 0; i < total; i++) arena.summonToken(id, { keyword: kw, golden });
  },

  /** Echo: get a random Attachment (Magnetic minion) — golden grants two. */
  deathrattleGrantMagnetic(arena: EffectArena, _params: Record<string, unknown>): void {
    arena.grantRandomFromPool((c) => c.keywords.includes('M') && !c.token && !c.spell, arena.self.golden ? 2 : 1);
  },

  /** Get `count` random Dwarven Ales (golden doubles). A set without the Ales grants nothing rather than
   *  injecting unreachable cards. The attacker/rally guards stay with dispatch in the combat wrapper. */
  combatGrantAle(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantRandomFromPool(
      (c) => ALE_IDS.includes(c.id),
      (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1));
  },

  /** Big Huggies — Echo: put a named spell in hand (golden grants two). */
  deathrattleGrantSpell(arena: EffectArena, params: Record<string, unknown>): void {
    const id = typeof params.cardId === 'string' ? params.cardId : '';
    if (!id) return;
    arena.grantNamedCard(id, arena.self.golden ? 2 : 1);
  },

  /** Echo: put `count` copies of a named card in hand (golden doubles). */
  deathrattleGrantCardToHand(arena: EffectArena, params: Record<string, unknown>): void {
    const id = typeof params.cardId === 'string' ? params.cardId : '';
    if (!id) return;
    arena.grantNamedCard(id, (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1));
  },

  /** Echo: get `count` random Shop spells (golden doubles). `exactTier` pins the tier where the phase can
   *  express it (the shop); combat's settle-time channel keeps its legacy ≤-tavern-tier pick. */
  deathrattleGrantRandomSpell(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantRandomSpells(
      (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1),
      typeof params.exactTier === 'number' ? params.exactTier : undefined);
  },

  /** Anvilshade Smith — Echo: summon `count` tokens that INHERIT this body's Attack when higher than their
   *  printed floor (buffing the Smith buffs what its death produces), swinging immediately in combat (the
   *  charge is meaningless in a shop and the adapter ignores it there). Golden doubles the count. */
  echoSummonInheritAttackAndCharge(arena: EffectArena, params: Record<string, unknown>): void {
    const id = typeof params.token === 'string' ? params.token : '';
    if (!id) return;
    const count = (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1);
    for (let i = 0; i < count; i++) {
      const made = arena.summonToken(id, { charge: true });
      if (!made) break; // board full
      if (arena.self.attack > made.attack) made.attack = arena.self.attack;
    }
  },

  /** Flowing Monk — when a summon can't fit the full board: PERMANENTLY buff `count` random friends by
   *  base × (1 + floor(overflows/improveEvery)) × golden, plus the triple's flat top-up. Then the overflow
   *  itself accrues (× Rune of Mastery) and announces, so the live text climbs. Distinct targets. */
  overflowBuffRandom(arena: EffectArena, params: Record<string, unknown>): void {
    const every = Math.max(1, typeof params.improveEvery === 'number' ? params.improveEvery : 5);
    const step = Math.floor((arena.self.summonBonus ?? 0) / every);
    const flat = (arena.self as { overflowBonus?: number }).overflowBonus ?? 0;
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 2) * (1 + step) * g + flat;
    const h = (typeof params.health === 'number' ? params.health : 2) * (1 + step) * g + flat;
    // COPY before splicing: `friends()` may hand back the phase's live board array, and splicing that
    // would remove minions from the actual board (caught by Monk's own regression test).
    const pool = [...arena.friends()];
    const rng = arena.rng();
    for (let i = 0; i < (typeof params.count === 'number' ? params.count : 2) && pool.length > 0; i++) {
      arena.buffPermanent(pool.splice(rng.int(pool.length), 1)[0]!, a, h);
    }
    const tick = arena.improveReps();
    arena.self.summonBonus = (arena.self.summonBonus ?? 0) + tick;
    arena.logImprove(tick);
  },

  /** Ex-Galloper — Echo: summon a copy of itself WITHOUT the Echo re-triggering. THE COPY INHERITS the body
   *  it was — buffed stats and keywords — in BOTH phases (owner ruling 2026-08-04; the shop used to summon a
   *  plain base card). Golden doubles the count. */
  echoSummonCopyNoEcho(arena: EffectArena, params: Record<string, unknown>): void {
    const count = (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1);
    const hp = Math.max(1, arena.self.maxHealth ?? arena.self.health);
    for (let i = 0; i < count; i++) {
      const made = arena.summonToken(arena.self.cardId, {
        attack: arena.self.attack, health: hp, keywords: [...arena.self.keywords],
      });
      if (!made) break; // board full
      arena.stripEchoes(made); // the copy must not summon another on ITS death, and so on to the board cap
    }
  },

  /** Bane — whenever a Battlecry fires on your side: enchant your Imps (+ Fodder when `fodder`) run-wide,
   *  and apply Bane's Existence's Demon-widen — IN COMBAT TOO (owner ruling 2026-08-04; it was shop-only). */
  onBattlecryBuffFodder(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 1) * g;
    const h = (typeof params.health === 'number' ? params.health : 1) * g;
    if (params.fodder) arena.grantFodderAura(a, h);
    arena.grantImpAura(a, h);
    arena.applyBaneDemonWiden();
    // Flash Bane itself (+ any Fodder it enchanted) so the proc is visible even with no Imp out — the enchant
    // is run-wide, to the card TYPE. A shop FX stamp; combat's adapter no-ops (its FX ride the buff events).
    arena.stampKarwindFlash(arena.self);
    if (params.fodder) for (const f of arena.friends()) if (arena.isFodder(f)) arena.stampKarwindFlash(f);
  },

  /** Karwind — each Shout: your `tribe` gains +a/+h, except this minion's two NEIGHBOURS, who take the bigger
   *  adjacent grant INSTEAD. GOLDEN = 2× MAGNITUDE in both phases (owner ruling 2026-08-04; the shop used to
   *  pulse twice at base — equal totals, but one convention now). Karwind is its own tribe and never its own
   *  neighbour, so it takes the base grant. */
  onBattlecryBuffTribeAdjacentMore(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    const a = (typeof params.attack === 'number' ? params.attack : 2) * g;
    const h = (typeof params.health === 'number' ? params.health : 2) * g;
    const adjA = (typeof params.adjAttack === 'number' ? params.adjAttack : 4) * g;
    const adjH = (typeof params.adjHealth === 'number' ? params.adjHealth : 4) * g;
    const friends = arena.friends();
    const i = friends.findIndex((f) => f.uid === arena.self.uid);
    const neighbours = new Set((i < 0 ? [] : [friends[i - 1], friends[i + 1]]).filter(Boolean).map((f) => f!.uid));
    for (const f of friends) {
      if (tribe && tribe !== 'any' && !arena.isTribe(f, tribe)) continue;
      const adj = neighbours.has(f.uid);
      arena.buff(f, adj ? adjA : a, adj ? adjH : h);
      arena.stampKarwindFlash(f);
    }
  },

  /** Echo: give ALL your minions (of `tribe`, if set) RISE. First body born from the ECHO FAMILY SWEEP — it
   *  was combat-only, so a shop-fired trigger (Funeral on Loan et al.) silently did nothing. Now it works in
   *  both phases with no ruling needed: the sentence is phase-blind. */
  deathrattleGrantRebornAll(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    for (const f of arena.friends()) {
      if (f.uid === arena.self.uid || arena.hasReborn(f)) continue;
      if (tribe && !arena.isTribe(f, tribe)) continue;
      arena.grantReborn(f);
      arena.narrate(`${arena.nameOf(arena.self)} grants ${arena.nameOf(f)} Rise`);
    }
  },

  /** Rune of the Summit's grant (and kin): get `count` random minions of EXACTLY `tier` from your active
   *  tribes + neutral. Was shop-only; a combat-fired grant now lands via the replay's toHand flight. */
  deathrattleGainRandomMinion(arena: EffectArena, params: Record<string, unknown>): void {
    const tier = typeof params.tier === 'number' ? params.tier : 5;
    const tribes = arena.activeTribes();
    arena.grantRandomFromPool(
      (c) => {
        const d = c as { tier?: number; tribe?: string };
        return d.tier === tier && (d.tribe === 'neutral' || tribes.includes(d.tribe ?? ''));
      },
      (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1));
  },

  /** Legion Shepherd — Echo: summon `count` Imps (count FIXED — golden scales the grant, not the bodies);
   *  every Imp that can't fit instead improves your Imps EVERYWHERE, permanently, by +a/+h per overflow.
   *  ARENA-BORN shop half (owner report 2026-08-04: a borrowed Shepherd summoned nothing and never overflowed
   *  — it had no shop half at all). */
  deathrattleImpsOverflowGrant(arena: EffectArena, params: Record<string, unknown>): void {
    const total = typeof params.count === 'number' ? params.count : 4;
    let overflowed = 0;
    for (let i = 0; i < total; i++) {
      // Count landings by BOARD SIZE, not the summon's return — combat's summon can defer a body onto the
      // immediate-attack queue and return nothing for a summon that WILL land (the legacy half counted
      // `living()` length for exactly this reason; caught by the full-board overflow test).
      const before = arena.friends().length;
      arena.summonToken('impscrap');
      if (arena.friends().length === before) overflowed++; // didn't land → it overflowed
    }
    if (overflowed === 0) return;
    const g = arena.self.golden ? 2 : 1;
    arena.grantImpAura(
      (typeof params.attack === 'number' ? params.attack : 2) * g * overflowed,
      (typeof params.health === 'number' ? params.health : 2) * g * overflowed);
  },

  /** Blaster — Echo: deal `amount` to EVERY minion (golden doubles). In the shop that means your own board —
   *  a borrowed Blaster is a live grenade, by ruling. */
  deathrattleDamageAll(arena: EffectArena, params: Record<string, unknown>): void {
    arena.damageAll((typeof params.amount === 'number' ? params.amount : 3) * (arena.self.golden ? 2 : 1));
  },

  /** Nanon — Echo: summon `count` tokens (count FIXED); every one that can't fit instead buffs your `tribe`
   *  minions +a/+h EACH (golden doubles the buff). ARENA-BORN shop half — same class as Legion Shepherd. */
  deathrattleSummonOverflowBuff(arena: EffectArena, params: Record<string, unknown>): void {
    const id = typeof params.tokenId === 'string' ? params.tokenId : '';
    if (!id) return;
    const total = typeof params.count === 'number' ? params.count : 6;
    let overflowed = 0;
    for (let i = 0; i < total; i++) {
      const before = arena.friends().length;
      arena.summonToken(id);
      if (arena.friends().length === before) overflowed++; // didn't land → it overflowed
    }
    if (overflowed === 0) return;
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 2) * g * overflowed;
    const h = (typeof params.health === 'number' ? params.health : 2) * g * overflowed;
    for (const f of arena.friends()) {
      if (!tribe || arena.isTribe(f, tribe)) arena.buff(f, a, h);
    }
  },

  /** Soulsman's kin — Echo: cast Lantern of Souls (golden casts twice). ARENA-BORN shop half: a shop-fired
   *  trigger now really casts the spell — the permanent Undead aura lands, and Guel / Spirit Pup / the rune
   *  meters all see a cast, because it IS one. */
  deathrattleCastTribeAttack(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = typeof params.tribe === 'string' && params.tribe ? params.tribe : 'undead';
    const amount = typeof params.amount === 'number' ? params.amount : 3;
    for (let i = 0; i < (arena.self.golden ? 2 : 1); i++) {
      arena.castTribeAttackSpell(tribe, amount, 'lanternofsouls');
    }
  },

  // ────────────────────────────────── THE SHOUT FAMILY ──────────────────────────────────
  // Every body added here + registered in FACTORIES shrinks replayCombatBattlecry's legacy switch, which now
  // dispatches FACTORIES-FIRST. When the switch is empty it dies, and COMBAT_REPLAYABLE_BATTLECRIES with it.

  /** Shout: summon `count` copies of a token (golden doubles — Alleycat 1 → 2, Shaper 2 → 4). */
  battlecrySummon(arena: EffectArena, params: Record<string, unknown>): void {
    const id = typeof params.tokenId === 'string' ? params.tokenId : '';
    if (!id) return;
    const count = (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1);
    for (let i = 0; i < count; i++) arena.summonToken(id);
  },

  /** Shout: your `tribe` minions gain +atk/+hp (golden doubles; `includeSelf: false` for "other"). */
  battlecryBuffTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 0) * g;
    const h = (typeof params.health === 'number' ? params.health : 0) * g;
    const includeSelf = params.includeSelf !== false;
    for (const f of arena.friends()) {
      if (!arena.isTribe(f, tribe)) continue;
      if (!includeSelf && f.uid === arena.self.uid) continue;
      arena.buff(f, a, h);
    }
  },

  /** Imp Overseer's Shout: your Imps gain +atk/+hp, run-wide and permanent (golden doubles). */
  battlecryBuffImps(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    arena.grantImpAura(
      (typeof params.attack === 'number' ? params.attack : 2) * g,
      (typeof params.health === 'number' ? params.health : 2) * g);
  },

  /** Deathswarmer's Shout: your Undead gain +Attack EVERYWHERE, permanently (golden doubles). */
  battlecryBuffUndeadAttack(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantUndeadAttackAura((typeof params.amount === 'number' ? params.amount : 1) * (arena.self.golden ? 2 : 1));
  },

  /** Warhorn Captain's Shout: your OTHER `tribe` minions gain +Attack (golden doubles). */
  battlecryBuffTribeOthersAttack(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = typeof params.tribe === 'string' ? params.tribe : '';
    const a = (typeof params.attack === 'number' ? params.attack : 1) * (arena.self.golden ? 2 : 1);
    if (a <= 0) return;
    for (const f of arena.friends()) {
      if (f.uid === arena.self.uid) continue;
      if (tribe && !arena.isTribe(f, tribe)) continue;
      arena.buff(f, a, 0);
    }
  },

  /** Frenzied Excavator's Shout: play `rubies` Rubies on ALL your minions (golden doubles). N SEPARATE
   *  Rubies, not one of N× magnitude — "play 2 Rubies has to mean two" (the shop half's documented design:
   *  a gilded Excavator pays a Ruby Broker twice and bounces an Idol twice). Unification FIXES the combat
   *  half to that per-Ruby trigger count — it used to fold `per` into one notification. */
  battlecryPlayRubiesAll(arena: EffectArena, params: Record<string, unknown>): void {
    const per = (typeof params.rubies === 'number' ? params.rubies : 1) * (arena.self.golden ? 2 : 1);
    if (per <= 0) return;
    for (const f of arena.friends()) {
      for (let r = 0; r < per; r++) arena.playRubiesOn(f, 1);
    }
  },

  /** Targeted stat Shout (Brood Whelp / Baby Gastrid's kin): buff the chosen friend — or, unchosen (a
   *  Myra / Dawnclaw re-fire, or combat), auto-pick the highest-Attack OTHER friend honouring `targetTribe`,
   *  falling back to self. The chosen target rides `params.target`, merged by the shop wrapper. */
  battlecryBuffTarget(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    const a = (typeof params.attack === 'number' ? params.attack : 0) * g;
    const h = (typeof params.health === 'number' ? params.health : 0) * g;
    if (a <= 0 && h <= 0) return;
    let target = params.target as ArenaBody | undefined;
    if (!target) {
      const restrict = arena.targetTribe();
      const ok = (f: ArenaBody): boolean => !restrict || arena.isTribe(f, restrict);
      const others = arena.friends().filter((f) => f.uid !== arena.self.uid && ok(f));
      const pool = others.length > 0 ? others : ok(arena.self) ? [arena.self] : [];
      if (pool.length === 0) return;
      target = pool.reduce((x, y) => (y.attack > x.attack ? y : x));
    }
    arena.buff(target, a, h);
  },

  /** Targeted keyword Shout (Toxin Tender / Plaguebringer): grant keyword(s) to the chosen friend — or
   *  auto-pick the highest-Attack friend that still LACKS one (never wasting it), honouring `targetTribe`.
   *  Unification FIXED drift: combat's auto-pick ignored both the lacks-check and the tribe restriction. */
  battlecryGrantKeyword(arena: EffectArena, params: Record<string, unknown>): void {
    const kws = Array.isArray(params.keywords) ? (params.keywords as string[]) : [];
    if (kws.length === 0) return;
    let target = params.target as ArenaBody | undefined;
    if (!target) {
      const restrict = arena.targetTribe();
      const lacks = (f: ArenaBody): boolean => kws.some((k) => !f.keywords.includes(k));
      const ok = (f: ArenaBody): boolean => lacks(f) && (!restrict || arena.isTribe(f, restrict));
      const others = arena.friends().filter((f) => f.uid !== arena.self.uid && ok(f));
      const pool = others.length > 0 ? others : ok(arena.self) ? [arena.self] : [];
      if (pool.length === 0) return;
      target = pool.reduce((x, y) => (y.attack > x.attack ? y : x));
    }
    for (const k of kws) {
      if (!target.keywords.includes(k)) arena.grantKeywordTo(target, k);
    }
  },

  /** Oathshield Orin's Shout: THIS minion gains a keyword (golden re-grants the same one — no stronger). */
  battlecryGainKeyword(arena: EffectArena, params: Record<string, unknown>): void {
    const kw = typeof params.keyword === 'string' ? params.keyword : '';
    if (kw && !arena.self.keywords.includes(kw)) arena.grantKeywordTo(arena.self, kw);
  },

  /** Cinderwing Matron's Shout: permanently raise run-wide spell power (golden doubles). */
  battlecryBuffSpellPower(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    arena.grantSpellPower(
      (typeof params.attack === 'number' ? params.attack : 0) * g,
      (typeof params.health === 'number' ? params.health : 0) * g);
  },

  /** Foam Reader's kin — Shout: permanently raise the run's spell power (golden doubles). The run-channel
   *  twin of `battlecryBuffSpellPower`; kept as its own id because content names them separately. */
  battlecryGrantSpellPowerRun(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    arena.grantSpellPower(
      (typeof params.attack === 'number' ? params.attack : 0) * g,
      (typeof params.health === 'number' ? params.health : 0) * g);
  },

  /** The Godfodder (option A) — Shout: your Fodder gain +atk/+hp run-wide, permanently (golden doubles) —
   *  the same whole-ritual Fodder enchant Bane stacks (`grantFodderAura`). */
  battlecryBuffFodder(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    arena.grantFodderAura(
      (typeof params.attack === 'number' ? params.attack : 1) * g,
      (typeof params.health === 'number' ? params.health : 1) * g);
  },

  /** Scrap Herald — Shout: your Magnetics ("Attachments") gain +atk/+hp WHEREVER they are, permanently
   *  (golden doubles) — the Magnetic sibling of the Undead attack aura, with a Health half. */
  battlecryBuffMagnetics(arena: EffectArena, params: Record<string, unknown>): void {
    const g = arena.self.golden ? 2 : 1;
    arena.grantMagneticAura(
      (typeof params.attack === 'number' ? params.attack : 2) * g,
      (typeof params.health === 'number' ? params.health : 2) * g);
  },

  /** Elderhorn "Hunt" — Shout: your Beast Rallies/Slaughters trigger `extra` more times, permanently
   *  (golden doubles). */
  battlecryGrantBeastHunt(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantBeastExtra((typeof params.extra === 'number' ? params.extra : 1) * (arena.self.golden ? 2 : 1), 0);
  },

  /** Elderhorn "Ritual" — Shout: your Beast Echoes trigger `extra` more times, permanently (golden doubles). */
  battlecryGrantBeastRitual(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantBeastExtra(0, (typeof params.extra === 'number' ? params.extra : 1) * (arena.self.golden ? 2 : 1));
  },
} as const;
