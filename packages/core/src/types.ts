import type { Rng } from './rng';
import type { CombatBus } from './events';

export type Tribe = 'beast' | 'undead' | 'mech' | 'dragon' | 'demon' | 'neutral';

/** Keyword codes (handoff A.4). */
export type Keyword =
  | 'T' // Taunt
  | 'DS' // Divine Shield
  | 'P' // Poison
  | 'W' // Windfury
  | 'R' // Reborn
  | 'C' // Cleave
  | 'M' // Magnetic
  | 'SC' // Start of Combat
  | 'CN' // Consume
  | 'FD' // Fodder — a cheap minion meant to be Consumed
  | 'IMM' // Immune — takes no damage
  | 'ST'; // Stealth — can't be targeted by attacks; lost on attacking

export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

export type Side = 'player' | 'enemy';

/** Trigger names the effect system can subscribe to. */
export type GameEvent =
  | 'onPlay'
  | 'onSummon'
  | 'onDeath'
  | 'onAttack'
  | 'onDamaged'
  | 'onLoseDivineShield'
  | 'onConsume'
  | 'onKill'
  | 'startOfCombat'
  | 'avenge' // after X friendly minions have died in combat
  | 'onBuy'
  | 'onSell'
  | 'endOfTurn' // recruit phase: the turn ends (End Turn / timer hits 0)
  | 'cast' // a spell's own effect resolves (its chosen target is in the payload)
  | 'spellCast'; // recruit phase: any spell was cast (for spell-tracking minions)

/**
 * Identifiers of registered effect primitives. Cards reference these by name
 * (data, not code). The combat simulator implements the combat-time set; the
 * run loop (`@game/sim`, M1) implements the recruit-time set. Grows as new
 * primitives are genuinely needed.
 */
export type EffectFactoryId =
  // combat-time (resolved inside simulate)
  | 'deathrattleSummon'
  | 'buffOnSummon'
  | 'deathrattleBuffTribe'
  | 'reAttackOnKill'
  | 'scDamage'
  | 'scSplitDamage'
  | 'scAoePerTribe'
  | 'deathrattleBuffRandom'
  | 'onFriendDeathBuffRandom'
  | 'deathrattleFillTribe'
  | 'avengeBuff' // Avenge (X): after X friendly deaths, buff self (combat)
  // Mechs — Divine Shield walls + shield-break payoffs (resolved in combat)
  | 'scGrantShieldTribe'
  | 'deathrattleGrantShield'
  | 'onShieldBreakGrantShield'
  | 'onShieldBreakDamage'
  | 'onShieldBreakBuffAll'
  // Demons — Consume / destroy (combat-resolved half)
  | 'onFriendDeathSummon'
  | 'scDestroyHighestAttack'
  // recruit-time (resolved by @game/sim, baked into stats before combat)
  | 'battlecryBuffTribe'
  | 'battlecrySummon'
  | 'buffOnBuy'
  | 'battlecryGrantKeyword'
  | 'endOfTurnBuff' // End of Turn: buff self (recruit)
  // Demons — Consume (recruit-resolved half)
  | 'battlecryConsume'
  | 'consumeFodderOnSummon'
  | 'battlecryAddTavernFodder' // Soulfeeder: queue a Fodder into the next tavern
  | 'avengeImproveSummon' // Kennelmaster: Avenge (X) permanently improves its summon buff
  | 'onConsumeBuffSelf'
  | 'onConsumeGrantSelfKeyword'
  // Spells (recruit-resolved): a spell's own effect, and minions that cast spells
  | 'spellBuffTarget' // cast: buff the chosen target +atk/+hp (+ optional keyword: Spirit Fire, Bulwark)
  | 'castSpell' // a minion casts a named spell (auto-targets a friend)
  | 'gainEmbers'; // cast: gain Embers (untargeted — Ember Pouch)

export interface EffectDef {
  on: GameEvent;
  do: EffectFactoryId;
  params?: Record<string, unknown>;
}

/** Immutable card definition (data). Never mutated — cloned into Minions. */
export interface CardDef {
  id: string;
  name: string;
  tribe: Tribe;
  tier: Tier;
  attack: number;
  health: number;
  keywords: Keyword[];
  effects: EffectDef[];
  /** Exact newcomer-facing text (handoff A.7), shipped verbatim. */
  text: string;
  /** Non-buyable token (e.g. Pup, Stray, Imp Scrap). */
  token?: boolean;
  /** A spell, not a minion: cast from hand for an effect, never takes a board slot. */
  spell?: boolean;
  /** Purchase cost. Minions omit this (they use CONFIG.minionCost); spells set it. */
  cost?: number;
  /** Requires the player to pick a friendly minion when played/cast (spells, targeted Battlecries). */
  target?: 'friendly';
  /** Demons: stat multiplier when this minion consumes a Fodder (Voracious Imp = 2; golden = +1).
   *  Default (absent) is 1 — a plain Demon gains the fodder's base stats. */
  fodderMult?: number;
}

/**
 * A board minion as it enters combat — a card id plus its *current* stats
 * (after recruit-phase buffs have been baked in by `@game/sim`). For M0 the
 * harness constructs these directly.
 */
export interface BoardMinion {
  cardId: string;
  attack: number;
  health: number;
  /** Overrides the card's keywords if present (e.g. a granted Poison). */
  keywords?: Keyword[];
  golden?: boolean;
  /** Extra magnitude added to this minion's summon-buff effect (Kennelmaster's Avenge
   *  improvements, persisted across the run). Default 0. */
  summonBonus?: number;
  /** The originating recruit board card's uid, so combat can report per-instance state
   *  (e.g. Avenge improvements) back for the run to persist. */
  sourceUid?: string;
}

/** A live combat instance. Mutable for the duration of one `simulate()` call. */
export interface Minion {
  uid: string;
  cardId: string;
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  maxHealth: number;
  keywords: Keyword[];
  divineShield: boolean;
  rebornAvailable: boolean;
  /** Tripled minion — combat-time effects fire at doubled magnitude. */
  golden: boolean;
  /** Derived combat capability (Gnasher): attacks again after a kill. */
  reAttackOnKill: boolean;
  /** Extra magnitude on this minion's summon-buff (Kennelmaster), grown by Avenge in
   *  combat and carried back to the run board afterwards. */
  summonBonus: number;
  /** The originating run board card's uid (if any), for per-instance carry-back. */
  sourceUid?: string;
  side: Side;
  effects: EffectDef[];
  dead: boolean;
}

export interface MinionSnapshot {
  uid: string;
  cardId: string;
  name: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
}

/**
 * The replayable combat log. The UI animates these on its own clock and never
 * recomputes outcomes. Vocabulary matches the prototype's proven set plus
 * `summon`/`buff` for combat-time effects (Deathrattles, summon buffs).
 */
export type CombatEvent =
  | { type: 'sc'; source: string; text: string }
  | { type: 'attack'; attacker: string; defender: string; swing: number }
  | { type: 'dmg'; target: string; amount: number; remainingHp: number }
  | { type: 'shield'; target: string }
  | { type: 'shieldUp'; target: string }
  | { type: 'poison'; target: string }
  | { type: 'reborn'; target: string; hp: number }
  | { type: 'death'; target: string }
  | { type: 'reveal'; target: string } // a Stealth minion attacked and lost Stealth
  | { type: 'summon'; minion: MinionSnapshot; side: Side; index: number }
  | { type: 'buff'; target: string; attack: number; health: number; source: string };

export type CombatOutcome = 'win' | 'lose' | 'draw';

export interface CombatResult {
  events: CombatEvent[];
  result: CombatOutcome;
  /** Resolve the player loses on defeat (handoff A.3 step 9). 0 otherwise. */
  playerDamage: number;
  /** Starting rosters, for the UI to render before replaying the log. */
  initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] };
  /** Per-instance state to persist on the run board after combat, keyed by the board
   *  card's uid (Kennelmaster's Avenge-improved summon bonus). Only entries that changed. */
  playerSummonBonus?: { sourceUid: string; bonus: number }[];
}

/**
 * The combat-time API exposed to effect factories. Factories mutate state and
 * push events only through this surface.
 */
export interface CombatContext {
  readonly rng: Rng;
  readonly bus: CombatBus;
  readonly boards: Record<Side, Minion[]>;
  readonly events: CombatEvent[];
  log(event: CombatEvent): void;
  living(side: Side): Minion[];
  getCard(id: string): CardDef;
  buff(target: Minion, attack: number, health: number, source: string): void;
  summon(side: Side, card: CardDef, nearUid?: string): Minion;
  /** Deal damage to a combat minion (used by Start-of-Combat and on-break effects). */
  damage(target: Minion, amount: number, poison?: boolean, bypassShield?: boolean): void;
}
