import type { Rng } from '../rng';
import { ALE_IDS, type CardDef, type EffectDef } from '../types';

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
  /** RALLY FAMILY — attacks this body has WITNESSED in the current dispatch (Crypt Drake's "every 2 ally
   *  attacks", Rouge Rogue's Imp tally). Per-fight in combat; the shop dispatcher scopes it to one End-of-Turn
   *  pass (see `fireRallies`) so a shop rally can never inherit last turn's count. */
  attackSeen?: number;
  /** RALLY FAMILY — Evolving Abomination's per-dispatch doubling counter (combat: `Minion.bredCount`, the
   *  Brood Matron per-fight cap; shop: cleared around each End-of-Turn pass, same rationale as `attackSeen`). */
  bredCount?: number;
  /** RALLY FAMILY — Sunmane Herald's per-instance accrued rally Attack (what this body passes on when it
   *  rallies). The escalation IS this number; it carries with the body in both phases. */
  rallySpreadAtk?: number;
  /** SC FAMILY — combat's live Ward flag (Mirrorhide's copy inherits it). Shop bodies carry the `DS`
   *  keyword instead and leave this undefined; adapters that can't express it simply ignore it. */
  divineShield?: boolean;
  /** SC FAMILY — combat's live Rise flag (spent Rise ≠ the printed `R` keyword). Shop: undefined. */
  rebornAvailable?: boolean;
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
  summonToken(tokenId: string, opts?: { attack?: number; health?: number; keyword?: string; keywords?: readonly string[]; golden?: boolean; charge?: boolean; rubyLabel?: boolean;
    /** SC FAMILY (Mirrorhide's copy): a wounded body's separate max. Combat folds it into the summon
     *  snapshot; the shop's printed Health IS its max, so the adapter ignores it. */
    maxHealth?: number;
    /** SC FAMILY: carry the live Ward/Rise FLAGS onto the copy (combat only — the shop reads keywords). */
    divineShield?: boolean; rebornAvailable?: boolean }): ArenaBody | undefined;
  /** Play `per` Rubies on a body — each phase's own ritual: combat routes through `playRubyOn` (rubyBonus +
   *  Deepdelve multiplier + the target's onRubyPlayed listeners); the shop applies `(1+rubyBonus)×per` as a
   *  'Ruby' buff and fires its watchers. */
  playRubiesOn(t: ArenaBody, per: number, permanent?: boolean): void;
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
  /** CONDUCTOR's run-wide snowball, N. Its Shout gives adjacent bodies +(2N)/+(3N) and N grows by one per
   *  Conductor PLAYED. Read-only from the arena: a combat RE-FIRE (Ryme, a parting cry, Dawnclaw) is a
   *  trigger, not a play, so it applies the current N without advancing it — the shop's play path owns the
   *  increment. Combat carries the value on `CombatSideState.conductorBuff`; the shop reads `RunState`. */
  conductorTally(): number;
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
  grantRandomFromPool(pred: (card: CardDef) => boolean, count: number): void;
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
  /** Narrate a beat into the combat log (`sc` text). A shop no-op — the shop has FX, not narration.
   *  `cast` marks the line as a cast-styled moment (the legacy `cast: true` on scDamage's strike). */
  narrate(text: string, cast?: boolean): void;
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
   *  and logs the keyword event so the pill appears; the shop appends to the card's keywords).
   *  `silent` suppresses the combat log event, for a grant that is bookkeeping rather than a moment (Sunmane
   *  Herald stamping `RL` on a Beast so the UI reads it as a Rally minion — the legacy body never logged it,
   *  and an extra event would change the replay). */
  grantKeywordTo(t: ArenaBody, kw: string, silent?: boolean): void;
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

  // ── RALLY FAMILY (Step 3 item 4) ──────────────────────────────────────────────────────────────────────
  //
  // The Rally family is the first migrated family with ENEMY-FACING members, and the shop has no enemies.
  // Rather than special-casing "am I in a shop?" inside a body, membership answers it: `enemies()` returns
  // [] in the shop, so `if (targets.length === 0) return` — a guard those bodies already had for an emptied
  // enemy board — makes them inert there by construction. No body reads `arena.phase`.
  /** Living opponents in board order. COMBAT: the other side. SHOP: `[]` — there is genuinely no one to
   *  hit, which is what makes every enemy-facing Rally a graceful no-op at End of Turn. */
  enemies(): ArenaBody[];
  /** Deal `amount` to a body (splash — no retaliation). Only ever reachable through `enemies()`, so the
   *  shop adapter's implementation is unreachable-by-construction and no-ops. */
  damage(t: ArenaBody, amount: number): void;
  /** Remove a keyword from a body (Tauntbreaker). Combat also disarms the live flag (Rise removed → it
   *  cannot come back this fight) and logs `keywordLost` so the pill drops. */
  stripKeyword(t: ArenaBody, kw: string): void;
  /** The side's SHOP-SPELL power (combat: the side's captured value; shop: `spellAttackBonus`/`Health`). */
  spellPower(): { attack: number; health: number };
  /** THE cast chokepoint: run `body` once per genuine cast, counting each one. Combat routes through
   *  `castInCombat` (golden = two real casts × the side's granted extras); the shop counts the named spell
   *  through `noteSpellCast` so every per-spell watcher sees it, golden twice. `spellId` names the spell
   *  being cast where one exists (Growth, Staff of Guel, Lantern of Souls) — the shop needs it to count. */
  castRepeat(spellId: string | undefined, body: () => void): void;
  /** Cast a NAMED spell for real, resolving its own effect (Dragonflame). Combat: `castNamedSpellInCombat`;
   *  shop: the actual card through the shop's cast pipeline. Golden casts twice in both. */
  castNamedSpell(spellId: string): void;
  /** A card definition by id (combat: `ctx.getCard`; shop: `CARD_INDEX`). Read-only. */
  cardDef(id: string): CardDef | undefined;
  /** Permanently buff everything you BUY (the Staff of Guel channel). Combat carries it back through
   *  `gainTavernBuy`; the shop raises `tavernBuyBonus` directly. */
  gainShopBuff(attack: number, health: number): void;
  /** The permanent run-wide UNDEAD aura (the Lantern of Souls channel — Attack and Health). Combat rides
   *  `grantUndeadAura` (carried back); the shop raises `undeadAttackBonus`/`undeadHealthBonus`. */
  grantUndeadAura(attack: number, health: number): void;
  /** Get `count` Rubies in hand (combat: the grant channel, minted at settle with the run's live Ruby
   *  power; shop: `mintRubies` right now — the same line, same bonus). */
  grantRubies(count: number): void;
  /** Get `count` random SHOUT minions (a real `onPlay`) from the run's pinned pool, tier-capped. */
  grantRandomShoutMinion(count: number): void;
  /** Does this body carry an effect on `on` (optionally with a specific `do`)? Combat reads the LIVE
   *  per-instance effect list (grafts included), the shop reads the printed def plus its grants. */
  hasEffect(t: ArenaBody, on: string, doId?: string): boolean;
  /** Re-fire a body's Shout, whole-ritual per phase: combat replays the combat-meaningful halves and emits
   *  `battlecryTriggered` (so Karwind / Bane / Embermouth proc); the shop runs `replayBattlecry`, which
   *  already counts the Shout and procs the same watchers. */
  replayShout(t: ArenaBody): void;
  /** Does this body have an Echo? `strict` keeps Deathsayer's narrower reading (only `deathrattle*` ids —
   *  a friend-death watcher is not an Echo), the wider reading counts ANY `onDeath` effect. */
  hasEcho(t: ArenaBody, strict?: boolean): boolean;
  /** Fire a body's Echo WITHOUT it dying, whole-ritual per phase: combat runs `triggerEcho` (every Echo
   *  multiplier the side has, × this minion's gild, each proc through the echo chokepoint, logging the
   *  `rally` cue); the shop runs its own Echo dispatch (which applies Sylus/Uron and the tally itself),
   *  once per gild. `strict` narrows to `deathrattle*` effects (Deathsayer). */
  triggerEchoOn(t: ArenaBody, strict?: boolean): void;
  /** Graft an effect onto a body for the rest of its life (Sunmane Herald's spreading Rally). Combat
   *  registers it on the live instance; the shop appends to the card's per-instance `grantedEffects`, which
   *  the recruit dispatchers read alongside the printed def. */
  graftEffect(t: ArenaBody, effect: EffectDef): void;
  /** Chorus Engine's "improve your Attachments", whole-ritual per phase: combat buffs the living unwelded
   *  Magnetics and stacks the run channel (welded/held copies inherit at settle); the shop buffs every
   *  Magnetic on board and in hand and stacks the same channel. */
  improveAttachments(attack: number, health: number): void;

  // ── START-OF-COMBAT FAMILY (Step 3 item 4) ────────────────────────────────────────────────────────────
  //
  // The second family with cross-phase dispatch (Rune of Combat Prowess replays these at End of Turn). The
  // Rally rules carry over: enemy-facing bodies no-op by MEMBERSHIP (`enemies()` is empty in the shop), and
  // the verbs below that only mean anything mid-fight are documented shop no-ops — the same class as
  // `addTribeAura` ("no rest-of-combat in a shop").
  /** Bloodbinder's Bleed: mark `targets` enemies now; every `every` attacks they take this body's Attack.
   *  A COMBAT mark on enemies that don't exist in a shop — the shop adapter no-ops (nothing to bleed). */
  armBleed(every: number, targets: number): void;
  /** Runebloom Matriarch's channel: your Shop Spells cast `extra` more times IN COMBAT. Pure combat-cast
   *  bookkeeping — a shop End of Turn has no combat casts to multiply, and the real Start of Combat fires
   *  moments later with the full grant, so the shop adapter no-ops rather than double-arming it. */
  grantSpellCastExtra(extra: number): void;
  /** Fodder consumed THIS TURN by this side (Abhorrent Horror's absorb). Combat reads the captured per-side
   *  tally; the shop reads the live run tally — the same number, moments apart. */
  fodderConsumed(): { attack: number; health: number };
  /** Dwarven Ales cast last shop turn ("this turn" from the player's chair — Bucky / Drunken Oaf). */
  alesLastTurn(): number;
  /** Taurus: Engrave the two adjacent bodies (whole-ritual per phase — combat marks `EG` + the golden
   *  `gainMult`, exactly the legacy board-slot reading). A shop no-op: Engrave means "keep your combat
   *  gains", and every shop gain is already permanent — there is nothing to keep. */
  engraveNeighbours(text?: string): void;
  /** Taurus the Truth Bringer: Engrave EVERY friendly body. Same shop no-op rationale as above. */
  engraveBoard(): void;
  /** Quil: cast the LEFTMOST Shop Spell in hand on the adjacent `tribe` minions — a REAL cast (counted,
   *  watcher-visible), whole-ritual per phase. Combat runs the legacy castInCombat + combat resolver; the
   *  shop mirrors the resolver's STAT family (buffs + spell power) through `noteSpellCast`, and lets pure
   *  tavern work fizzle without counting, exactly as the combat ruling has it. */
  castLeftmostHandSpellOnAdjacent(tribe: string): void;
  /** A body's Echo (onDeath) effects, param-cloned — the Grave Body copy source. Combat reads the live
   *  instance list; the shop reads the printed def plus its grants. */
  echoEffectsOf(t: ArenaBody): EffectDef[];

  /** The phase's own random stream. See the RNG contract above. */
  rng(): Rng;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Tripled bodies fire their buff/damage effects at doubled magnitude (the `mul` of the legacy registries). */
const gold = (arena: EffectArena): number => (arena.self.golden ? 2 : 1);
/** Ceiling for Sunmane Herald's doubling rally. The escalation is deliberately unbounded as a DESIGN, but the
 *  arithmetic is not: ~50 rallies in one fight would reach Infinity and turn every downstream stat into NaN.
 *  Set far past any reachable board strength so it never binds in play. (Moved here with the body.) */
const RALLY_SPREAD_CAP = 1_000_000_000;

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

  /** Grim / Mushy — Echo: buff all living friends of `tribe` (+atk/+hp, golden doubles) and register a
   *  rest-of-combat aura at that magnitude ("wherever they are" — bodies summoned later inherit it; the shop
   *  adapter's `addTribeAura` is a documented no-op, since every shop gain is already permanent and the shop
   *  summons nothing later). `tribes` (plural) buffs SEVERAL tribes in one pass — Mushy's "Beasts & Dragons" —
   *  as one aura per tribe, with each dual-type body buffed ONCE.
   *
   *  MEMBERSHIP is `friends()`, which INCLUDES a still-living self: a Grim whose Echo is proc'd WITHOUT dying
   *  (Spots, Echohorn, Rune of the Herald — or the same procs replayed at End of Turn under Rune of Combat
   *  Prowess / Lasting Cadence) is a living Beast and gains its own buff, in BOTH phases (owner report
   *  2026-08-20: the hand-written shop half excluded `self`, so a shop-proc'd Grim buffed everyone but
   *  itself). A Grim that actually DIED is already out of `friends()` in either phase — combat filters the
   *  dead, and every shop death path removes the body from the board before its rattle fires. */
  // ── ARENA-MIGRATED (2026-08-20): one body in arena.ts serves both phases.
  deathrattleBuffTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const g = gold(arena);
    const a = num(params.attack) * g;
    const h = num(params.health) * g;
    const many = Array.isArray(params.tribes) ? (params.tribes as string[]) : null;
    if (many) {
      const hit = new Set<ArenaBody>();
      for (const t of many) {
        arena.addTribeAura(t, a, h);
        for (const f of arena.friends()) {
          if (arena.isTribe(f, t) && !hit.has(f)) hit.add(f);
        }
      }
      for (const f of hit) arena.buff(f, a, h);
      return;
    }
    const tribe = str(params.tribe) || 'any';
    arena.addTribeAura(tribe, a, h);
    for (const f of arena.friends()) {
      if (tribe === 'any' || arena.isTribe(f, tribe)) arena.buff(f, a, h);
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
   *  plain base card). Golden doubles the count, AND the copies of a gilded body are themselves Gilded
   *  (q-copy-gilded-badge, owner REVISE 2026-08-27: "exact copies without the echo, so they would be gilded
   *  too" — matching `scSummonCopy` / Mirrorhide's convention). */
  echoSummonCopyNoEcho(arena: EffectArena, params: Record<string, unknown>): void {
    const count = (typeof params.count === 'number' ? params.count : 1) * (arena.self.golden ? 2 : 1);
    const hp = Math.max(1, arena.self.maxHealth ?? arena.self.health);
    for (let i = 0; i < count; i++) {
      const made = arena.summonToken(arena.self.cardId, {
        attack: arena.self.attack, health: hp, keywords: [...arena.self.keywords], golden: arena.self.golden,
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
  /** CONDUCTOR — Shout: give the two ADJACENT bodies +(attack×N)/+(health×N), N being the run-wide snowball.
   *  ARENA-BACKED so it resolves in BOTH phases: it used to be a recruit-only factory, which meant every
   *  in-combat Shout re-fire treated it as "economy" and deferred it to settle — i.e. it did nothing during
   *  the fight (owner report 2026-08-26). N is floored at 1 so a body that never went through the shop's play
   *  path (summoned, Discovered onto the board) still pays its printed +2/+3 rather than nothing. */
  battlecryConductorAdjacent(arena: EffectArena, params: Record<string, unknown>): void {
    const n = Math.max(1, arena.conductorTally());
    const a = (typeof params.attack === 'number' ? params.attack : 2) * n;
    const h = (typeof params.health === 'number' ? params.health : 3) * n;
    for (const adj of arena.neighboursOf(arena.self)) arena.buff(adj, a, h);
  },

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

  // ── RALLY FAMILY (Step 3 item 4) ───────────────────────────────────────────────────────────────────────
  //
  // Rally is an `onAttack` trigger, so COMBAT owns the dispatch: the wrapper in `FACTORIES` keeps the payload
  // guard that decides WHOSE attack this is (`minion !== self` for an own-swing Rally, `minion.side` for an
  // ally-attack watcher) and hands the body the attacker as `params.attacker`. The shop's dispatcher
  // (`fireRallies`) supplies the same shape at End of Turn under Rune of Lasting Cadence.
  //
  // PERMANENCE. Every buff below is a PLAIN `arena.buff` unless the printed card says otherwise, which means:
  // temporary in combat (the legacy behaviour, unchanged — this side is a pure refactor) and permanent in the
  // shop, because a shop buff is permanent by definition. Where a card promises permanence regardless of phase
  // — Paragon's "permanently", Boulderdash/Blazer's permanent Rubies, every run-channel grant (Ruby power,
  // spell power, Undead aura, shop enchant, Imp aura, Attachment enchant) — the body says so explicitly, via
  // `buffPermanent`, the `permanent` flag on `playRubiesOn`, or the run channel itself.
  //
  // ENEMY-FACING RALLIES no-op in the shop by MEMBERSHIP, not by a phase check: `enemies()` is empty there and
  // `params.target` is absent, so `rallyDamageRandomEnemy` and `onAttackStripKeywords` fall out of their own
  // "nothing to hit" guard before they draw RNG or touch state.

  /** Rally — when THIS minion attacks, buff friendly minions (+atk/+hp). No extra params = every other living
   *  friend; `tribe` restricts (dual-types count) and `count` caps how many are hit, a random pick when more
   *  are eligible (Supporter: 2 friendly Dragons). Golden doubles the magnitude. */
  rallyBuff(arena: EffectArena, params: Record<string, unknown>): void {
    const g = gold(arena);
    const attack = num(params.attack, 1) * g;
    const health = num(params.health, 1) * g;
    const tribe = str(params.tribe);
    let friends = arena.friends().filter((m) => m.uid !== arena.self.uid && (!tribe || arena.isTribe(m, tribe)));
    const cap = num(params.count, 0); // 0 = all eligible friends
    if (cap > 0 && friends.length > cap) {
      const pickable = [...friends];
      const rng = arena.rng();
      friends = [];
      for (let i = 0; i < cap && pickable.length > 0; i++) {
        const m = rng.pick(pickable);
        pickable.splice(pickable.indexOf(m), 1);
        friends.push(m);
      }
    }
    for (const m of friends) arena.buff(m, attack, health);
  },

  /** Chimerus — Rally: give up to 2 friendly Dragons +Health equal to its own Health. MAX Health, not the
   *  damaged current value (owner ruling 2026-08-08). Golden runs the whole hand-out TWICE (re-picking each
   *  round). In the shop a card's printed Health IS its max, so `maxHealth ?? health` reads correctly in both. */
  rallyGiveHealthToDragons(arena: EffectArena, _params?: Record<string, unknown>): void {
    const amt = arena.self.maxHealth ?? arena.self.health;
    if (amt <= 0) return;
    const rng = arena.rng();
    for (let round = 0; round < gold(arena); round++) {
      const pickable = arena.friends().filter((m) => m.uid !== arena.self.uid && arena.isTribe(m, 'dragon'));
      for (let i = 0; i < 2 && pickable.length > 0; i++) {
        const m = rng.pick(pickable);
        pickable.splice(pickable.indexOf(m), 1);
        arena.buff(m, 0, amt);
      }
    }
  },

  /** Badgington / Perfect Core's weld — Rally: get a random Shop spell (golden 2). */
  rallyGrantSpell(arena: EffectArena, _params?: Record<string, unknown>): void {
    arena.grantRandomFromPool((c) => !!c.spell && !c.token, gold(arena));
  },

  /** Mechanical Jouster — Rally: get a random Magnetic MECH (golden 2 per rally). */
  rallyGrantMagnetic(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantRandomFromPool(
      (c) => c.keywords.includes('M') && (c.tribe === 'mech' || c.tribe2 === 'mech') && !c.token && !c.spell,
      num(params.count, 1) * gold(arena),
    );
  },

  /** Paragon — whenever you TRIGGER A RALLY, give a minion of every type +atk/+hp, PERMANENTLY.
   *
   *  One random member of each tribe actually represented on your board by a real tribe member, plus every
   *  all-type body (an all-type minion IS a minion of every type, so Paragon always pays itself). The gate is
   *  the ATTACKER's `RL` keyword — an ordinary ally swing is not a Rally.
   *
   *  `buffPermanent` states the permanence the card prints: in combat it accrues `permaGain` (the Flowing Monk
   *  channel) so the gifts ride home; in the shop a buff is already permanent.
   *
   *  `permanent: false` (Standard Bearer, owner 2026-09-01) makes the gift last the FIGHT only — the same
   *  recipients, the same fan-out, just an ordinary `buff` that never accrues `permaGain`. A param rather
   *  than a second factory because permanence is the ONLY thing the two cards disagree about, and splitting
   *  them would have left two copies of the pick-one-per-tribe rule to keep in step. Defaults to permanent,
   *  so Paragon and every existing author keep the behaviour they printed. */
  onRallyBuffOnePerTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const attacker = params.attacker as ArenaBody | undefined;
    if (!attacker || !attacker.keywords.includes('RL')) return;
    const g = gold(arena);
    const a = num(params.attack, 3) * g;
    const h = num(params.health, 3) * g;
    const living = arena.friends();
    const universal = living.filter((m) => arena.isUniversalTribe(m));
    const real = living.filter((m) => !arena.isUniversalTribe(m));
    const tribes: string[] = [];
    for (const m of real) for (const t of arena.tribesOf(m)) if (!tribes.includes(t)) tribes.push(t);
    const recipients: ArenaBody[] = [...universal];
    const rng = arena.rng();
    for (const t of tribes) {
      const pool = real.filter((m) => arena.tribesOf(m).includes(t));
      if (pool.length === 0) continue;
      const pick = rng.pick(pool);
      if (!recipients.some((r) => r.uid === pick.uid)) recipients.push(pick);
    }
    const permanent = params.permanent !== false;
    for (const r of recipients) {
      if (permanent) arena.buffPermanent(r, a, h);
      else arena.buff(r, a, h);
    }
  },

  /** Taragosa / Fatecarver — when any ally attacks, CAST GROWTH: buff every living friend. A real cast
   *  (`castRepeat`), so it inherits the run's spell power and every per-spell watcher sees it; golden casts
   *  twice. `option` gates the Choose One branch (absent = ungated, so Taragosa is unaffected). */
  onAllyAttackCastGrowth(arena: EffectArena, params: Record<string, unknown>): void {
    if (num(params.option, -1) >= 0 && arena.self.chosenOption !== num(params.option, -1)) return;
    const sp = arena.spellPower();
    const a = num(params.attack, 3) + sp.attack;
    const h = num(params.health, 4) + sp.health;
    arena.castRepeat(str(params.spellId) || undefined, () => {
      for (const m of arena.friends()) arena.buff(m, a, h);
    });
  },

  /** Embercrest — Rally: re-trigger the Shouts of your other `tribe` minions. Routed through the shared
   *  Shout-replay ritual (`replayShout`), which in combat also emits `battlecryTriggered` so Karwind / Bane /
   *  Embermouth proc, and in the shop counts the Shout for the quest tallies. Golden re-triggers each twice. */
  rallyTriggerTribeShouts(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe);
    const reps = gold(arena);
    for (const m of arena.friends()) {
      if (m.uid === arena.self.uid) continue;
      if (tribe && !arena.isTribe(m, tribe)) continue;
      if (!arena.hasEffect(m, 'onPlay')) continue;
      for (let r = 0; r < reps; r++) {
        arena.narrate(`${arena.nameOf(arena.self)} triggers ${arena.nameOf(m)}'s Shout`);
        arena.replayShout(m);
      }
    }
  },

  /** Trophy Stalker — Rally: grant your `tribe` +N/+N, where N GROWS by `step` each rally. The accrual rides
   *  `summonBonus` (per-instance, carried back), so the printed live text climbs. The rest-of-combat aura for
   *  later arrivals is a combat-only concept — `addTribeAura` is a shop no-op and the board loop covers it. */
  rallyTribeAuraGrowing(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe) || 'beast';
    const g = gold(arena);
    const bonus = arena.self.summonBonus ?? 0;
    const a = (num(params.attack, 3) + bonus) * g;
    const h = (num(params.health, 3) + bonus) * g;
    if (a > 0 || h > 0) {
      arena.addTribeAura(tribe, a, h);
      for (const m of arena.friends()) if (tribe === 'any' || arena.isTribe(m, tribe)) arena.buff(m, a, h);
    }
    const inc = num(params.step, 1) * arena.improveReps(); // Rune of Mastery: the Improve applies twice
    arena.self.summonBonus = bonus + inc;
    arena.logImprove(inc);
  },

  /** Errand Fiend — Rally: summon an Imp AND enchant your Imps run-wide (golden doubles both). */
  rallySummonImpBuffImps(arena: EffectArena, params: Record<string, unknown>): void {
    const g = gold(arena);
    for (let i = 0; i < g; i++) arena.summonToken('impscrap');
    const n = num(params.amount, 1) * g;
    arena.grantImpAura(n, n);
  },

  /** Sunmane Herald — Rally: give your OTHER `tribe` minions +Attack and GRAFT this rally onto them, so every
   *  Beast it touches becomes another Herald.
   *
   *  The escalation is EMERGENT (owner spec 2026-07-25): a carrier grants whatever it has ACCUMULATED
   *  (`rallySpreadAtk`) plus its own printed base, so later carriers hand out more purely because they were
   *  handed more. It never buffs the ATTACKER, which is what keeps Sunmane itself granting its printed +3
   *  forever. Only the printed card carries a base; the graft is written `attack: 0`. Accumulation is
   *  per-instance, so a body that dies loses its stacks and a fresh arrival starts empty. */
  rallySpreadTribeBuff(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe) || 'beast';
    const value = num(params.attack, 0) * gold(arena) + (arena.self.rallySpreadAtk ?? 0);
    if (value <= 0) return;
    // `combatOnly` rides the graft too (owner ruling 2026-08-20): a carrier's spread-Rally is as shop-inert
    // as the printed Sunmane one — the loop this scopes out must not re-enter through a grafted copy.
    const graft: EffectDef = { on: 'onAttack', do: 'rallySpreadTribeBuff', params: { ...(params ?? {}), attack: 0 }, combatOnly: true };
    for (const m of arena.friends()) {
      if (m.uid === arena.self.uid || !arena.isTribe(m, tribe)) continue; // never the attacker — see above
      arena.buff(m, value, 0);
      // Clamped: the growth is exponential in a long fight and would otherwise reach Infinity and poison
      // every downstream stat as NaN. The ceiling is far past any reachable board strength.
      m.rallySpreadAtk = Math.min((m.rallySpreadAtk ?? 0) + value, RALLY_SPREAD_CAP);
      if (!arena.hasEffect(m, 'onAttack', 'rallySpreadTribeBuff')) {
        if (!m.keywords.includes('RL')) arena.grantKeywordTo(m, 'RL', true); // so the UI reads it as a Rally minion
        arena.graftEffect(m, graft);
      }
    }
  },

  /** Crownvein Vanguard — Rally: improve your Rubies (× golden), through the permanent Ruby-power channel. */
  rallyRubyStatGain(arena: EffectArena, params: Record<string, unknown>): void {
    const g = gold(arena);
    arena.grantRubyPower(num(params.attack, 1) * g, num(params.health, 1) * g);
  },

  /** Echohorn Stag — Rally: trigger your LEFT-MOST OTHER friendly Echo (it stays alive). ANY `onDeath` effect
   *  is an Echo, not just ids that start with "deathrattle" (owner report 2026-07-31). Golden triggers twice —
   *  folded into the shared `triggerEchoOn` ritual with every other Echo multiplier the side has. */
  rallyProcLeftmostEcho(arena: EffectArena, _params?: Record<string, unknown>): void {
    const target = arena.friends().find((m) => m.uid !== arena.self.uid && arena.hasEcho(m));
    if (target) arena.triggerEchoOn(target);
  },

  /** Hawkus — whenever a RALLY is triggered (an ally with `RL` attacks), trigger your left-most other Echo. */
  onRallyProcLeftmostEcho(arena: EffectArena, params: Record<string, unknown>): void {
    const attacker = params.attacker as ArenaBody | undefined;
    if (!attacker || !attacker.keywords.includes('RL')) return; // an ally swing is not a Rally
    const target = arena.friends().find((m) => m.uid !== arena.self.uid && arena.hasEcho(m));
    if (target) arena.triggerEchoOn(target);
  },

  /** Deathsayer — Rally: fire your LEFT-MOST living Echo (itself included — the legacy reading). NARROWER than
   *  the Stag: only true `deathrattle*` effects count, not friend-death watchers like Brood Matron. The proc
   *  count (Sylus / Uron / Elderhorn / Grave Contract, × this minion's gild) lives in `triggerEchoOn`. */
  rallyProcDeathrattle(arena: EffectArena, _params?: Record<string, unknown>): void {
    const target = arena.friends().find((m) => arena.hasEcho(m, true));
    if (target) arena.triggerEchoOn(target, true);
  },

  /** Boulderdash — Rally: play `count` PERMANENT Rubies on itself (× golden). */
  rallyPlayRubiesSelf(arena: EffectArena, params: Record<string, unknown>): void {
    arena.playRubiesOn(arena.self, num(params.count, 1) * gold(arena), params.permanent === true);
  },

  /** Blazer — Rally: play `count` PERMANENT Rubies on EVERY friendly minion (× golden). */
  rallyPlayRubiesAll(arena: EffectArena, params: Record<string, unknown>): void {
    const per = num(params.count, 1) * gold(arena);
    const permanent = params.permanent === true;
    for (const m of arena.friends()) arena.playRubiesOn(m, per, permanent);
  },

  /** Chorus Drake — Rally: permanently raise the run's SHOP-SPELL power (golden doubles). */
  rallyGrantSpellPower(arena: EffectArena, params: Record<string, unknown>): void {
    const g = gold(arena);
    arena.grantSpellPower(num(params.attack, 0) * g, num(params.health, 1) * g);
  },

  /** Herald of the Apocalypse — Rally: get a copy of itself (golden 2). */
  rallyGrantSelfCopy(arena: EffectArena, _params?: Record<string, unknown>): void {
    arena.grantNamedCard(arena.self.cardId, gold(arena));
  },

  /** Roarcollector — Rally: get a random SHOUT minion, tier-capped by the run pool (golden 2). */
  rallyGrantRandomShoutMinion(arena: EffectArena, _params?: Record<string, unknown>): void {
    arena.grantRandomShoutMinion(gold(arena));
  },

  /** Lieutenant Thane — Rally: hand THIS minion's current Attack to `count` random other friendlies. Distinct
   *  picks per repetition, re-rolled for the golden second pass. `excludeId` drops minions of that card id
   *  from the pool, so a pair of Thanes can't pump each other into a runaway loop (owner 2026-08-11). */
  rallyGiveAttackToOthers(arena: EffectArena, params: Record<string, unknown>): void {
    const amount = arena.self.attack;
    if (amount <= 0) return;
    const rng = arena.rng();
    const exclude = str(params.excludeId);
    for (let r = 0; r < gold(arena); r++) {
      const pool = arena.friends().filter((m) => m.uid !== arena.self.uid && (!exclude || m.cardId !== exclude));
      for (let n = 0; n < num(params.count, 3) && pool.length > 0; n++) {
        arena.buff(pool.splice(rng.int(pool.length), 1)[0]!, amount, 0);
      }
    }
  },

  /** Tunnelcharger Rikk — Rally: get `count` Rubies (× golden), minted at the run's live Ruby power. */
  rallyGetRubies(arena: EffectArena, params: Record<string, unknown>): void {
    arena.grantRubies(num(params.count, 1) * gold(arena));
  },

  /** Evolving Abomination — Rally: double this minion's stats, `max` times per dispatch. GOLDEN raises the CAP
   *  rather than the multiplier (doubling twice as hard isn't a thing). Health doubles off CURRENT health: a
   *  wounded body doubles what it has left, which is what the board in front of you reads as. */
  rallyDoubleSelf(arena: EffectArena, params: Record<string, unknown>): void {
    const cap = Math.max(1, num(params.max, 2)) * gold(arena);
    if ((arena.self.bredCount ?? 0) >= cap) return;
    arena.self.bredCount = (arena.self.bredCount ?? 0) + 1;
    if (arena.self.attack <= 0 && arena.self.health <= 0) return;
    arena.buff(arena.self, arena.self.attack, arena.self.health);
  },

  /** Philippe — Rally: also deal its current Attack to a RANDOM living enemy (golden +2 more). Pure splash, so
   *  the struck body never retaliates. ENEMY-FACING: `enemies()` is empty in the shop, so this returns before
   *  it draws — no crash, no half-application, and no RNG-cursor drift at End of Turn. */
  rallyDamageRandomEnemy(arena: EffectArena, params: Record<string, unknown>): void {
    const targets = arena.enemies();
    if (targets.length === 0) return;
    const bonus = arena.self.golden ? num(params.goldenBonus, 2) : 0;
    arena.damage(arena.rng().pick(targets), arena.self.attack + bonus);
  },

  /** Watcher — Rally: cast Lantern of Souls (the permanent run-wide UNDEAD aura). A real cast, so per-spell
   *  payoffs see it; the grant folds the run's spell power into BOTH stats. Only Undead is wired, mirroring
   *  the recruit `spellGrantTribeAttack`. `grantUndeadAura` is the whole ritual per phase — combat buffs the
   *  living Undead and carries the aura home, the shop raises the run channel the board already reads. */
  rallyCastTribeAttack(arena: EffectArena, params: Record<string, unknown>): void {
    const undead = str(params.tribe) === 'undead';
    const sp = arena.spellPower();
    const a = num(params.amount, 3) + sp.attack;
    const h = sp.health;
    // The cast itself is unconditional (the legacy body's shape, preserved): a Watcher pointed at an unwired
    // tribe still CASTS — it just grants nothing. Only Undead has a run channel today.
    arena.castRepeat(str(params.spellId) || 'lanternofsouls', () => {
      if (undead && (a > 0 || h > 0)) arena.grantUndeadAura(a, h);
    });
  },

  /** Hoardbreaker Drake — Rally: "cast Growth" by NAME, reading the spell's own printed stats so the card and
   *  the spell can never drift. Buffs the board by those stats + spell power; golden = two genuine casts. */
  rallyCastSpell(arena: EffectArena, params: Record<string, unknown>): void {
    const spell = arena.cardDef(str(params.spellId));
    const eff = spell?.effects.find((e) => e.do === 'spellBuffAll' || e.do === 'spellBuffTarget');
    if (!eff) return;
    const sp = arena.spellPower();
    const a = num(eff.params?.attack, 0) + sp.attack;
    const h = num(eff.params?.health, 0) + sp.health;
    if (a <= 0 && h <= 0) return;
    arena.castRepeat(spell?.id, () => {
      const targets = eff.do === 'spellBuffAll'
        ? arena.friends()
        : arena.friends().filter((m) => m.uid !== arena.self.uid);
      for (const t of targets) arena.buff(t, a, h);
    });
  },

  /** Ashen Broodlord — Rally: CAST A STAFF OF GUEL. The buff is the Staff's: a PERMANENT run-wide tavern-buy
   *  enchant (`gainShopBuff`), scaled by spell power. Golden casts it TWICE rather than doubling one cast. */
  rallyCastShopBuffSpell(arena: EffectArena, params: Record<string, unknown>): void {
    const sp = arena.spellPower();
    const a = num(params.attack, 2) + sp.attack;
    const h = num(params.health, 2) + sp.health;
    arena.castRepeat(str(params.spellId) || 'staffofguel', () => arena.gainShopBuff(a, h));
  },

  /** Flamebeat Drake — Rally: cast a NAMED spell (Dragonflame) for real; golden = two casts. Untargeted spells
   *  resolve their own random targeting inside the phase's cast resolver. */
  rallyCastNamedSpell(arena: EffectArena, params: Record<string, unknown>): void {
    arena.castNamedSpell(str(params.spellId));
  },

  /** Demon Horse — Rally: PERMANENTLY buff every minion in the Shop (the Staff-of-Guel channel, per the owner's
   *  standing rule that "give minions in the Shop" survives a reroll — ruling 2026-07-25). */
  rallyBuffShopPermanent(arena: EffectArena, params: Record<string, unknown>): void {
    const g = gold(arena);
    arena.gainShopBuff(num(params.attack, 2) * g, num(params.health, 2) * g);
  },

  /** Packstrider — Rally: buff ITSELF by `attack`/`health` for every friendly `tribe` minion (itself included). */
  rallyBuffSelfPerTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe);
    const count = arena.friends().filter((m) => !tribe || arena.isTribe(m, tribe)).length;
    if (count <= 0) return;
    const g = gold(arena);
    arena.buff(arena.self, num(params.attack, 1) * g * count, num(params.health, 1) * g * count);
  },

  /** Cinderchef — Rally: gain +atk/+hp (golden doubles). */
  rallyBuffSelf(arena: EffectArena, params: Record<string, unknown>): void {
    const g = gold(arena);
    arena.buff(arena.self, num(params.attack, 1) * g, num(params.health, 1) * g);
  },

  /** Equinox Duelist (Dawn Rally) — buff every friendly CELESTIAL (a flagged card, not a tribe). Includes
   *  self: the Duelist is a Celestial too. Note this one has NO own-attack guard in either registry — the
   *  alignment gate is the whole condition, exactly as the legacy body had it. */
  rallyBuffCelestials(arena: EffectArena, params: Record<string, unknown>): void {
    const g = gold(arena);
    const a = num(params.attack, 0) * g;
    const h = num(params.health, 0) * g;
    for (const m of arena.friends()) if (arena.isCelestial(m)) arena.buff(m, a, h);
  },

  /** Chorus Engine — Rally: IMPROVE your Attachments (×2 under Rune of Mastery), permanently and wherever they
   *  are (owner 2026-07-29). `improveAttachments` is the whole ritual per phase — combat reaches the unwelded
   *  Magnetics on the field and stacks the run channel for the welded/held ones; the shop reaches board + hand
   *  directly and stacks the same channel for future copies. */
  rallyBuffAttachments(arena: EffectArena, params: Record<string, unknown>): void {
    const reps = arena.improveReps();
    const g = gold(arena);
    arena.improveAttachments(num(params.attack, 2) * g * reps, num(params.health, 2) * g * reps);
  },

  /** Warflame — whenever a friendly `tribe` minion attacks, cast a NAMED spell (Dragonflame). */
  onTribeAttackCastNamedSpell(arena: EffectArena, params: Record<string, unknown>): void {
    const attacker = params.attacker as ArenaBody | undefined;
    if (!attacker) return;
    const tribe = str(params.tribe);
    if (tribe && !arena.isTribe(attacker, tribe)) return;
    arena.castNamedSpell(str(params.spellId));
  },

  /** Whenever ANOTHER friendly `tribe` minion attacks, buff THE ATTACKER (+atk/+hp, golden doubles). */
  onTribeAttackBuffAttacker(arena: EffectArena, params: Record<string, unknown>): void {
    const attacker = params.attacker as ArenaBody | undefined;
    if (!attacker || attacker.uid === arena.self.uid) return;
    if (!arena.isTribe(attacker, str(params.tribe))) return;
    const g = gold(arena);
    arena.buff(attacker, num(params.attack, 2) * g, num(params.health, 1) * g);
  },

  /** Mineral Master — when YOU trigger a Rally (any friendly `RL` body attacks), play `rubies` Rubies on your
   *  `tribe` minions. The attacker's `RL` keyword is the gate: without it this would pay out on every ally
   *  swing, which is an ally-attack watcher, not a Rally watcher. */
  onRallyPlayRubiesTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const attacker = params.attacker as ArenaBody | undefined;
    if (!attacker || !attacker.keywords.includes('RL')) return;
    const tribe = str(params.tribe);
    const per = num(params.rubies, 2) * gold(arena);
    for (const m of arena.friends()) if (!tribe || arena.isTribe(m, tribe)) arena.playRubiesOn(m, per);
  },

  /** Rouge Rogue — whenever an IMP attacks, give your Imps +N/+N, improving by `improve` every `improveEvery`
   *  Imp attacks. The escalation rides `summonBonus`, the attack tally rides `attackSeen`. */
  onImpAttackBuffImps(arena: EffectArena, params: Record<string, unknown>): void {
    const attacker = params.attacker as ArenaBody | undefined;
    if (!attacker || attacker.cardId !== 'impscrap') return;
    arena.self.attackSeen = (arena.self.attackSeen ?? 0) + 1;
    const every = Math.max(1, num(params.improveEvery, 3));
    const a = (num(params.attack, 3) + (arena.self.summonBonus ?? 0)) * gold(arena);
    for (const m of arena.friends()) if (m.cardId === 'impscrap') arena.buff(m, a, a);
    if (arena.self.attackSeen % every === 0) {
      const inc = num(params.improve, 1);
      arena.self.summonBonus = (arena.self.summonBonus ?? 0) + inc;
      arena.logImprove(inc);
    }
  },

  /** Raptor — when ANOTHER friendly minion of `tribe` attacks, buff it. Excludes self: a support body, not a
   *  self-ramp. `tribe: 'any'` (or absent) means every ally. */
  onFriendlyAttackBuffTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const attacker = params.attacker as ArenaBody | undefined;
    if (!attacker || attacker.uid === arena.self.uid) return;
    const tribe = str(params.tribe) || 'any';
    if (tribe !== 'any' && !arena.isTribe(attacker, tribe)) return;
    const g = gold(arena);
    arena.buff(attacker, num(params.attack, 1) * g, num(params.health, 1) * g);
  },

  /** Tauntbreaker — on attack, strip the listed keywords off the enemy it HITS, so the target loses Taunt
   *  (stops forcing targeting) and Rise (won't return after it dies). ENEMY-FACING: the defender rides
   *  `params.target`, which only a real attack has — in the shop there is nobody being hit, so this returns
   *  immediately rather than half-applying to a friendly. */
  onAttackStripKeywords(arena: EffectArena, params: Record<string, unknown>): void {
    const target = params.target as ArenaBody | undefined;
    if (!target) return;
    const kws = Array.isArray(params.keywords) ? (params.keywords as string[]) : [];
    for (const kw of kws) if (target.keywords.includes(kw)) arena.stripKeyword(target, kw);
  },

  /** Thundeer — whenever a friendly `tribe` minion ATTACKS, this gains +N/+N, N improving by `step` after every
   *  proc (the accrual rides `summonBonus`). Thundeer carries Engraved, which is what makes the gain permanent
   *  across the run; this body only does the growth. */
  onAllyTribeAttackBuffSelf(arena: EffectArena, params: Record<string, unknown>): void {
    const attacker = params.attacker as ArenaBody | undefined;
    if (!attacker) return;
    const tribe = str(params.tribe);
    if (tribe && tribe !== 'any' && !arena.isTribe(attacker, tribe)) return;
    const g = gold(arena);
    const base = num(params.attack, 10) * g;
    const step = num(params.step, base) * g;
    const mag = base + (arena.self.summonBonus ?? 0);
    arena.buff(arena.self, mag, mag);
    arena.self.summonBonus = (arena.self.summonBonus ?? 0) + step;
    arena.logImprove(step);
  },

  /** Crypt Drake — every `every` ally attacks (itself included), buff every living friend +step/+step; every
   *  `improveEvery` attacks the grant improves PERMANENTLY for this copy (`summonBonus`, carried back). The
   *  per-dispatch attack counter rides `attackSeen`. Golden doubles both. */
  onAllyAttackBuffAll(arena: EffectArena, params: Record<string, unknown>): void {
    arena.self.attackSeen = (arena.self.attackSeen ?? 0) + 1;
    const every = Math.max(1, num(params.every, 2));
    const improveEvery = Math.max(1, num(params.improveEvery, 4));
    const step = num(params.step, 2) * gold(arena);
    if (arena.self.attackSeen % every === 0) {
      const mag = step + (arena.self.summonBonus ?? 0);
      for (const m of arena.friends()) arena.buff(m, mag, mag);
    }
    if (arena.self.attackSeen % improveEvery === 0) {
      const inc = step * arena.improveReps(); // Rune of Mastery: the Improve step applies twice
      arena.self.summonBonus = (arena.self.summonBonus ?? 0) + inc;
      arena.logImprove(inc);
    }
  },

  // ── START-OF-COMBAT FAMILY (Step 3 item 4) ─────────────────────────────────────────────────────────────
  //
  // Migrated for Rune of Combat Prowess ("your Start of Combat effects also trigger at End of Turn") — the
  // second cross-phase dispatcher, built on the Rally family's motion. The standing rules, restated:
  //
  // PERMANENCE. A plain `arena.buff` is temporary in combat (each body's legacy behaviour, unchanged) and
  // permanent in the shop, because a shop buff is permanent by definition. Run-channel grants (Rubies with
  // `permanent`, the per-instance `summonBonus`/`spellProgress` accruals) keep writing their channel ONCE
  // per fire, whichever phase fired them.
  //
  // ENEMY-FACING bodies (scDamage, scGrantEnemyTaunt) no-op in the shop by MEMBERSHIP: `enemies()` is empty
  // there, so their own "nothing to hit" guard returns before any narration, state touch or RNG draw — the
  // Rally family's `rallyDamageRandomEnemy` rule, applied unchanged.
  //
  // COMBAT-ONLY verbs (armBleed, grantSpellCastExtra, engrave*) are documented shop no-ops on the adapter —
  // the `addTribeAura` class: the sentence has no shop meaning, so the fire changes nothing and the empty
  // beat is discarded by the dispatcher's `discardIfEmpty`.

  /** Deal `amount` to the leftmost / a random / every living enemy. ENEMY-FACING: returns on the empty
   *  shop `enemies()` before it narrates or draws — no RNG-cursor drift at End of Turn. */
  scDamage(arena: EffectArena, params: Record<string, unknown>): void {
    const targets = arena.enemies();
    if (targets.length === 0) return;
    arena.narrate(str(params.text) || `${arena.nameOf(arena.self)} strikes`, true);
    const amount = num(params.amount, 1) * gold(arena);
    const mode = str(params.target) || 'leftmost';
    if (mode === 'all') {
      for (const t of targets) arena.damage(t, amount);
    } else if (mode === 'random') {
      arena.damage(arena.rng().pick(targets), amount);
    } else {
      arena.damage(targets[0]!, amount);
    }
  },

  /** Bloodbinder — arm Bleed on `targets` enemies (golden doubles the marks). A combat mark; the shop
   *  adapter's verb no-ops (there is nobody to bleed, and no attacks will tick it). */
  scArmBleed(arena: EffectArena, params: Record<string, unknown>): void {
    arena.armBleed(num(params.every, 4), num(params.targets, 1) * gold(arena));
  },

  /** Taurus — Engrave BOTH adjacent bodies (golden also doubles their combat stat-gains). Whole-ritual
   *  verb: the shop no-ops (all shop gains are already permanent — nothing to keep). */
  scEngraveNeighbor(arena: EffectArena, params: Record<string, unknown>): void {
    arena.engraveNeighbours(str(params.text) || undefined);
  },

  /** Taurus the Truth Bringer — Engrave EVERY friendly body ("triggers first" is the dispatcher's job,
   *  not this body's). Same shop no-op rationale as the neighbour version. */
  scEngraveAll(arena: EffectArena, _params: Record<string, unknown>): void {
    arena.engraveBoard();
  },

  /** Quil — cast your LEFTMOST hand Shop Spell on the adjacent Beasts, as a REAL counted cast. */
  scCastLeftmostHandSpell(arena: EffectArena, _params: Record<string, unknown>): void {
    arena.castLeftmostHandSpellOnAdjacent('beast');
  },

  /** Speed Demon — give every OTHER friendly minion `pct`% of THIS body's own stats (golden doubles the
   *  %), floored. A pure grant, phase-blind. */
  scBuffAlliesPctSelf(arena: EffectArena, params: Record<string, unknown>): void {
    const pct = num(params.pct, 50) * gold(arena);
    const ga = Math.floor((arena.self.attack * pct) / 100);
    const gh = Math.floor((arena.self.health * pct) / 100);
    if (ga <= 0 && gh <= 0) return;
    for (const m of arena.friends()) if (m.uid !== arena.self.uid) arena.buff(m, ga, gh);
  },

  /** Kobe — play `count` PERMANENT Rubies on itself and each adjacent same-`tribe` neighbour (× golden). */
  scPlayRubiesSelfAndAdjacentTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const per = num(params.count, 1) * gold(arena);
    const permanent = params.permanent === true;
    const tribe = str(params.tribe);
    arena.playRubiesOn(arena.self, per, permanent);
    for (const adj of arena.neighboursOf(arena.self)) {
      if (tribe && !arena.isTribe(adj, tribe)) continue;
      arena.playRubiesOn(adj, per, permanent);
    }
  },

  /** Runebloom Matriarch — your Shop Spells cast `extra` more times in combat (golden doubles; Rune of the
   *  Matriarch adds one more). The grant is a COMBAT-cast channel: the shop verb no-ops (the real Start of
   *  Combat re-fires with the full grant moments later — arming it at End of Turn too would double it). */
  scGrantSpellCastExtra(arena: EffectArena, params: Record<string, unknown>): void {
    const runeExtra = arena.self.cardId === 'b2_runebloom' && arena.matriarchReps() > 1 ? 1 : 0;
    const extra = num(params.extra, 1) * gold(arena) + runeExtra;
    if (extra <= 0) return;
    arena.grantSpellCastExtra(extra);
    arena.narrate(`${arena.nameOf(arena.self)}: your Shop Spells cast ${extra} extra time${extra === 1 ? '' : 's'}`);
  },

  /** Twilight Sentinel — THIS body gains a keyword (the align-gated halves live on the card). Re-granting
   *  a keyword it already has is a no-op, so an End-of-Turn replay after the real Start of Combat (or a
   *  second End of Turn) never stacks pills. */
  /**
   * ── "WHEN A CARD IS ADDED TO YOUR HAND" — the CROSS-PHASE bodies ────────────────────────────────────────
   *
   * Owner rule (2026-08-29): *"cards added to hand is an effect in recruit + shop and should trigger effects
   * that track them in all places."* A card can reach your hand mid-COMBAT too — every `ctx.grantToHand` and
   * every Ruby a combat effect mints — and until now none of those fired these reactors during the fight.
   * The stats still arrived at settle, on the recruit board, so the bug read as "Gangplank didn't trigger":
   * the payout came too late to affect the fight it was earned in.
   *
   * They live HERE, in the arena, rather than being reimplemented on the combat side, because a hand-written
   * combat twin is exactly how the shop and combat halves of an effect drift apart. Each phase supplies its
   * own DISPATCHER (the shop's hand uid-diff in `reduce`, combat's `grantToHand` chokepoint); the body below
   * is the single thing they both run.
   *
   * `gained` is the arriving card — the payload that makes Kegheart's Ale filter possible. It is a third
   * argument rather than a `params` key because it is per-FIRING data, not authored content.
   */

  /** Gangplank — a card reached hand: give ONE RANDOM friendly minion of `tribe` +attack/+health.
   *  Random, not left-most (owner report 2026-08-20) — one `rng.int` over the board-ordered pool, the same
   *  draw the recruit half made, so a replayed run picks the same body. */
  onGainCardBuffTribe(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe);
    const pool = arena.friends().filter((c) => !tribe || arena.isTribe(c, tribe));
    if (pool.length === 0) return;
    const rng = arena.rng();
    const target = pool[rng.int(pool.length)]!;
    const g = gold(arena);
    arena.buff(target, num(params.attack, 1) * g, num(params.health, 2) * g);
  },

  /** Kegheart Dwarf — "Whenever you get a Dwarven Ale, gain +3/+3" (golden +6/+6). Filters on the ARRIVING
   *  card being one of the five Ales, so every source pays it without knowing Kegheart exists. */
  onGainAleBuffSelf(arena: EffectArena, params: Record<string, unknown>, gained?: string): void {
    if (!gained || !ALE_IDS.includes(gained)) return;
    const g = gold(arena);
    arena.buff(arena.self, num(params.attack, 3) * g, num(params.health, 3) * g);
  },

  scGainKeyword(arena: EffectArena, params: Record<string, unknown>): void {
    const kw = str(params.keyword);
    if (!kw || arena.self.keywords.includes(kw)) return;
    arena.grantKeywordTo(arena.self, kw);
  },

  /** Gravewarden — give a friendly (optionally `tribe`) minion other than self Rise; golden grants two.
   *  Skips bodies that already have — or in combat have already spent — Rise (`hasReborn` folds both). */
  scGrantReborn(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe);
    const rng = arena.rng();
    for (let i = 0; i < gold(arena); i++) {
      const candidates = arena.friends().filter((m) =>
        m.uid !== arena.self.uid && !arena.hasReborn(m) && (!tribe || arena.isTribe(m, tribe)));
      if (candidates.length === 0) return;
      arena.grantReborn(rng.pick(candidates));
    }
  },

  /** Arena Heckler — Taunt the enemy OPPOSITE this body (golden: an adjacent one too). ENEMY-FACING:
   *  the empty shop `enemies()` returns before narration — nothing friendly is ever taunted. */
  scGrantEnemyTaunt(arena: EffectArena, params: Record<string, unknown>): void {
    const targets = arena.enemies();
    if (targets.length === 0) return;
    const own = arena.friends();
    const idx = Math.min(Math.max(own.findIndex((m) => m.uid === arena.self.uid), 0), targets.length - 1);
    const picks = [targets[idx]!];
    if (arena.self.golden) {
      const neighbour = targets[idx + 1] ?? targets[idx - 1];
      if (neighbour) picks.push(neighbour);
    }
    arena.narrate(str(params.text) || `${arena.nameOf(arena.self)} works the crowd`);
    for (const victim of picks) {
      if (victim.keywords.includes('T')) continue;
      arena.grantKeywordTo(victim, 'T');
    }
  },

  /** Daybreak Acolyte — THIS body gains stats (the align-gated halves live on the card; × golden). */
  scBuffSelf(arena: EffectArena, params: Record<string, unknown>): void {
    arena.buff(arena.self, num(params.attack, 0) * gold(arena), num(params.health, 0) * gold(arena));
  },

  /** Mirrorhide Rhino — summon a copy of THIS body's CURRENT self (stats, keywords, gild, live flags);
   *  golden summons two. A combat-summoned copy never re-fires Start of Combat; a shop copy is off the
   *  beat-list snapshot for the same reason — no chain either way. */
  scSummonCopy(arena: EffectArena, _params: Record<string, unknown>): void {
    for (let i = 0; i < gold(arena); i++) {
      arena.summonToken(arena.self.cardId, {
        attack: arena.self.attack, health: arena.self.health, maxHealth: arena.self.maxHealth,
        keywords: [...arena.self.keywords], golden: arena.self.golden,
        divineShield: arena.self.divineShield, rebornAvailable: arena.self.rebornAvailable,
      });
    }
  },

  /** Runescale Drake (2026-07-21 rework) — your `tribe` gains (base + improve) × spells-this-turn, the
   *  per-spell rate improving by `step` per `every` spells cast while this instance is out. FLOORED at one
   *  spell so a dry turn still pays the base rate. Golden doubles the whole grant. */
  scTribeBuffPerSpellImproving(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe) || 'dragon';
    const step = num(params.step, 1);
    const every = Math.max(1, num(params.every, 4));
    const improve = step * Math.floor((arena.self.spellProgress ?? 0) / every);
    const spells = Math.max(1, arena.spellsThisTurn());
    const g = gold(arena);
    const a = (num(params.attack, 2) + improve) * spells * g;
    const h = (num(params.health, 2) + improve) * spells * g;
    if (a <= 0 && h <= 0) return;
    arena.narrate(str(params.text) || `${arena.nameOf(arena.self)} channels the runes`);
    for (const m of arena.friends()) if (arena.isTribe(m, tribe)) arena.buff(m, a, h);
  },

  /** Bucky — give your `tribe` +A/+H PER Dwarven Ale cast last shop turn. Zero Ales is a clean no-op. */
  scTribeBuffPerAle(arena: EffectArena, params: Record<string, unknown>): void {
    const ales = arena.alesLastTurn();
    if (ales <= 0) return;
    const tribe = str(params.tribe) || 'dwarf';
    const g = gold(arena);
    const a = num(params.attack, 5) * ales * g;
    const h = num(params.health, 5) * ales * g;
    if (a <= 0 && h <= 0) return;
    arena.narrate(`${arena.nameOf(arena.self)} pours for ${ales} Ale${ales === 1 ? '' : 's'} (+${a}/+${h})`);
    for (const m of arena.friends()) if (arena.isTribe(m, tribe)) arena.buff(m, a, h);
  },

  /** Drunken Oaf — give A `tribe` minion +atk/+hp, repeated once more per Ale (reps = 1 + ales; the base
   *  grant lands on a dry turn too). Each rep re-rolls its target; self is eligible. Golden doubles the
   *  per-rep grant, never the rep count. */
  scBuffRandomTribePerAle(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe) || 'dwarf';
    const targets = arena.friends().filter((m) => arena.isTribe(m, tribe));
    if (targets.length === 0) return;
    const ales = arena.alesLastTurn();
    const reps = 1 + ales;
    const g = gold(arena);
    const a = num(params.attack, 2) * g;
    const h = num(params.health, 2) * g;
    if (a <= 0 && h <= 0) return;
    arena.narrate(str(params.text) || `${arena.nameOf(arena.self)} buys ${reps} round${reps === 1 ? '' : 's'} (+${a}/+${h})`);
    const rng = arena.rng();
    for (let n = 0; n < reps; n++) arena.buff(rng.pick(targets), a, h);
  },

  /** Pack Leader — buff your `tribe` +M/+M (M = base + the permanently accrued `summonBonus`), then improve
   *  the accrual by `step` FOR GOOD — a run channel, so an End-of-Turn fire advances it exactly once, like
   *  a combat fire does. Golden doubles the applied grant, not the accrual. */
  scTribeBuffImproving(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe) || 'beast';
    const base = num(params.attack, 2);
    const step = num(params.step, 2);
    const mag = (base + (arena.self.summonBonus ?? 0)) * gold(arena);
    if (mag > 0) {
      arena.narrate(`${arena.nameOf(arena.self)} leads the pack`);
      for (const m of arena.friends()) if (arena.isTribe(m, tribe)) arena.buff(m, mag, mag);
    }
    arena.self.summonBonus = (arena.self.summonBonus ?? 0) + step;
  },

  /** Abhorrent Horror — gain the Fodder stats consumed this turn (× golden). Reads the same tally in both
   *  phases (combat's captured copy vs the live run field — the same number, moments apart). */
  scGainFodderStats(arena: EffectArena, _params: Record<string, unknown>): void {
    const fc = arena.fodderConsumed();
    const g = gold(arena);
    const atk = fc.attack * g;
    const hp = fc.health * g;
    if (atk > 0 || hp > 0) {
      arena.narrate(`${arena.nameOf(arena.self)} absorbs the consumed essence`);
      arena.buff(arena.self, atk, hp);
    }
  },

  /** Kennelmaster / Thunderous Sovereign — buff your `tribe` now AND register the rest-of-combat aura for
   *  later arrivals (a shop no-op by design — there is no rest-of-combat in a shop). The Avenge accrual
   *  (`summonBonus`) applies per stat via `stepAttack`/`stepHealth`; golden doubles the whole grant. */
  scBeastAura(arena: EffectArena, params: Record<string, unknown>): void {
    const tribe = str(params.tribe) || 'beast';
    const g = gold(arena);
    const bonus = arena.self.summonBonus ?? 0;
    const a = (num(params.attack, 1) + bonus * num(params.stepAttack, 1)) * g;
    const h = (num(params.health, 1) + bonus * num(params.stepHealth, 1)) * g;
    if (a <= 0 && h <= 0) return;
    arena.narrate(str(params.text) || `${arena.nameOf(arena.self)} rallies the pack`);
    arena.addTribeAura(tribe, a, h);
    for (const m of arena.friends()) {
      if (tribe === 'any' || arena.isTribe(m, tribe)) arena.buff(m, a, h);
    }
  },

  /** Spots — trigger your `count` LEFT-MOST other friendly Echoes (they stay alive). Routed through the
   *  shared Echo ritual, so a SHOP fire pays the recruit Echo tallies (`lastEchoFires`, Aftershocks-class
   *  payoffs) exactly as every other shop-fired Echo does — the owner's quest-tally ruling (2026-08-20). */
  scTriggerLeftmostEchoes(arena: EffectArena, params: Record<string, unknown>): void {
    const targets = arena.friends()
      .filter((m) => m.uid !== arena.self.uid && arena.hasEcho(m))
      .slice(0, num(params.count, 2));
    for (const t of targets) arena.triggerEchoOn(t);
  },

  /** Grave Body — copy your LEFTMOST other friendly Echo: graft its onDeath effects onto THIS body. In the
   *  shop the graft rides `grantedEffects` and is therefore PERMANENT (the Rally-family shop-permanence
   *  rule; a combat graft lasts the fight — each phase's own legacy lifetime). */
  copyLeftmostEcho(arena: EffectArena, _params: Record<string, unknown>): void {
    const lead = arena.friends().find((m) => m.uid !== arena.self.uid && arena.hasEcho(m));
    if (!lead) return;
    for (const e of arena.echoEffectsOf(lead)) arena.graftEffect(arena.self, e);
  },
} as const;
