import type { BoardMinion, CombatSideState, Keyword, Tribe } from '@game/core';
import type { SetId } from '@game/content';
import type { RiftId } from '../config';

/**
 * PRODUCTION BOTS — the planning-safety boundary (handoff Ticket 0).
 *
 * Two rules the rest of the system is built on:
 *
 * 1. **Nothing speculative may touch the live run.** `reduce()` is authoritative but NOT safe to call against a
 *    shared state: its wrapper writes to its INPUT before `reduceCore()` clones — it resets `recruitBuffFx` and
 *    `auraFx`, stamps `weldFxBaseSeq`, and pins this wave's opponent into `servedBoards`. A search that called
 *    it directly would corrupt the player's run and every sibling candidate. Only `transition.ts` may call it,
 *    and only against a private clone.
 *
 * 2. **The bot may only see what a player can see.** The engine is seeded, so a naive search could clone the
 *    state, apply `roll`, and read the exact future shop before deciding whether to refresh — deterministic,
 *    and still cheating. `BotVisibleState` is a curated projection, not a filtered copy: it is built by naming
 *    what goes IN, so a new `RunState` field is invisible by default rather than leaking until someone notices.
 *
 * `RunState` has 225 fields. Anything absent here is either hidden information, presentation-only, or simply
 * not needed yet — this is the v1 decision surface and it is expected to grow as the evaluator does.
 */

/** A minion on the board or in hand, as the bot sees it. */
export interface BotCardView {
  uid: string;
  cardId: string;
  tribe: Tribe;
  tribe2?: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  golden: boolean;
  /** Per-instance accruals that change what a card is worth right now (Kennelmaster's improve, Guel's tally). */
  summonBonus?: number;
  spellProgress?: number;
  hpGrantBonus?: number;
  soldProgress?: number;
  attachments?: number;
}

/** A shop offer, with the price actually payable right now. */
export interface BotOfferView {
  uid: string;
  cardId: string;
  tribe: Tribe;
  tribe2?: Tribe;
  tier: number;
  attack: number;
  health: number;
  keywords: Keyword[];
  golden: boolean;
  /** Live cost after every discount/surcharge — not the printed one. */
  cost: number;
  spell: boolean;
  ruby: boolean;
  /** Kept through refreshes (frozen or Layaway). */
  kept: boolean;
}

export interface BotEconomyView {
  gold: number;
  maxGold: number;
  tier: number;
  upgradeCost: number;
  refreshCost: number;
  freeRolls: number;
  goldSpentThisTurn: number;
}

/** How a wielded power asks for its input — the vocabulary candidate generation keys on. */
export type BotPowerTargeting = 'passive' | 'untargeted' | 'friendly' | 'friendlyOrShop' | 'commission' | 'flashPick';

/** One wielded power (slot 0 = the main button; Void wields a second in slot 1). */
export interface BotPowerView {
  slot: 0 | 1;
  kind: string;
  targeting: BotPowerTargeting;
  /** Gold spent on activation (0 = free). */
  cost: number;
  /** Whether THIS power can fire right now — unlock wave, per-turn / per-game / max-uses gates and Gold. */
  ready: boolean;
}

export interface BotHeroView {
  heroId: string;
  resolve: number;
  armor: number;
  /** Whether the MAIN hero power can be used right now (slot 0). */
  powerReady: boolean;
  powerKind: string;
  /** Every wielded power with its targeting shape — what the generator enumerates activations from. */
  powers: readonly BotPowerView[];
}

/** One Equipment the player holds this turn (B2: Equipment is inside the planning boundary). */
export interface BotEquipmentView {
  equipmentId: string;
  name: string;
  version: 'plain' | 'gilded';
  /** Live activation price after every stacked reduction. */
  cost: number;
  /** Charges it can fire right now: its own remaining charge + the shared pool. */
  charges: number;
  targetMode: 'none' | 'friendly';
  /** The recruit factory one trigger resolves through (a Choose One Equipment lists its branches instead). */
  effectId: string;
  /** Branch effect ids when the Equipment opens a Choose One on use (Prismatic Pick). */
  chooseOne: readonly string[];
  /** True when the slot is showing this one — `activateEquipment` fires the SELECTED Equipment. */
  selected: boolean;
}

/** The Starform token sitting in the shop, with its live stats and price (Set 3). */
export interface BotStarformView {
  uid: string;
  attack: number;
  health: number;
  cost: number;
}

/** The friendly side exactly as combat would instantiate it — see `combatContext.ts`. Player-own state only. */
export interface BotFriendlyCombatView {
  bodies: readonly BoardMinion[];
  side: Omit<CombatSideState, 'poolIds'>;
}

/** Run-wide counters and auras a card's live value depends on. */
export interface BotRunCounters {
  spellsCast: number;
  spellsThisTurn: number;
  deathrattlesTriggered: number;
  triplesMade: number;
  cardsBoughtThisTurn: number;
  playedThisTurn: string[];
  /** Set 2 Kobolds: Rubies played this run (umbrella cards read spells + rubies). */
  rubyCasts: number;
  /** Set 3 Spirits: the shared Reveler value. */
  revelerX: number;
  /** The run-wide shop buff folded into every present and future offer. */
  tavernBuyBonus: { attack: number; health: number };
}

export interface BotAuraView {
  spellPower: { attack: number; health: number };
  beastBuyAtk: number;
  impBuff: { attack: number; health: number };
  undeadBuyAtk: number;
  magneticBuy: { attack: number; health: number };
  rubyBonus: { attack: number; health: number };
}

/** A choice the run is BLOCKED on — the bot must answer it before anything else is legal. */
export type BotMandatoryDecision =
  | { kind: 'discover'; options: string[] }
  | { kind: 'chooseOne'; sourceUid: string; options: string[]; /** Set when the prompt belongs to an Equipment (Prismatic Pick), not a card. */ equipmentId?: string }
  | { kind: 'battlecryTarget'; sourceUid: string; legalTargets: string[] }
  | { kind: 'quest'; options: string[] }
  | { kind: 'powerOffer'; options: string[] } // hero-power Discover (Mimic / Void): hero ids whose powers are offered
  | { kind: 'runeforge'; options: string[]; canReroll: boolean; canSkip: boolean }
  | { kind: 'scout' };

/**
 * THE ONLY state shape evaluation, strategy and tracing may inspect.
 *
 * Deliberately excludes: `seed`, `rngCursor`, `servedBoards` (the pinned future opponent), `lastCombat`,
 * `scoutedNextOpponent`, every `*Fx*` presentation field, and the action log.
 */
export interface BotVisibleState {
  version: 1;
  setId: SetId;
  riftId: RiftId | null;
  phase: string;
  wave: number;
  economy: BotEconomyView;
  hero: BotHeroView;
  board: readonly BotCardView[];
  hand: readonly BotCardView[];
  shop: readonly BotOfferView[];
  spellOffer: BotOfferView | null;
  frozen: boolean;
  runCounters: Readonly<BotRunCounters>;
  auras: Readonly<BotAuraView>;
  runes: readonly string[];
  quests: readonly { questId: string; progress: number; completed: boolean }[];
  /** Equipment held this turn, selected one flagged. Empty when the player holds none. */
  equipment: readonly BotEquipmentView[];
  /** The Starform token when one is in the shop (it is ALSO in `shop`; this is the fast path for its stats). */
  starform: BotStarformView | null;
  /** The friendly side as the real fight would prepare it — what `fightScore` fights with. */
  friendly: BotFriendlyCombatView;
  mandatoryDecision: BotMandatoryDecision | null;
  /** The bot's legal knowledge of other seats. Empty until Ticket 7 wires the opponent model. */
  opponentKnowledge: readonly unknown[];
}

/** Opaque outside `transition.ts`. Its `RunState` must never be handed back to an evaluator. */
export interface PlanningStateHandle {
  readonly id: string;
}

/** Result of applying one candidate action to a private clone. */
export interface PlanningTransition {
  /** False when the reducer rejected the action (returned its input) — a no-op candidate. */
  changed: boolean;
  child: PlanningStateHandle;
  visible: BotVisibleState;
  fingerprint: string;
  /** Set when the action revealed information the bot did not previously hold (a refresh, a Discover roll).
   *  Search must stop here and score the action with an expectation model instead of expanding the result. */
  reveal: RevealBoundary | null;
  /** True when the reducer consumed the run's RNG while applying this action — the dynamic half of the reveal
   *  audit. Any action that moved the cursor produced an outcome that depends on the hidden future. */
  rngConsumed: boolean;
}

export interface RevealBoundary {
  kind: 'refresh' | 'discover' | 'randomGrant' | 'randomTarget' | 'forge' | 'rngConsumed';
  /** Human-readable, for traces. */
  because: string;
}

/**
 * What a stored artifact was produced under. A replay, fixture, trace or lobby save that doesn't pin this can
 * be silently re-run against different content and quietly mean something else.
 */
export interface RulesIdentity {
  schemaVersion: number;
  contentVersion: string;
  buildId: string;
  setId: SetId;
  riftId: RiftId | null;
  /** Hash over the active card/rune/quest ids — changes when content changes, not when code does. */
  rulesHash: string;
}
