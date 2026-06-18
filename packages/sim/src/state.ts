import { makeRng } from '@game/core';
import type { CombatResult, Keyword, Rng, Tribe } from '@game/core';
import { CONFIG } from './config';
import { rollShop, stockPool } from './shop';
import { selectThreat, type ThreatId } from './threats';

/**
 * Tags that separate the run's RNG streams. The shop stream advances with the
 * player's rolls (its cursor lives in RunState); the threat/enemy/combat streams
 * are derived purely from (seed, wave) so they're identical every time a wave is
 * re-resolved — which is why the recruit-phase preview matches the actual fight.
 */
export const TAG = { THREAT: 1, ENEMY: 2, SHOP: 3, COMBAT: 4, TRIBES: 5, MAGNET: 6 } as const;

/** The playable (non-neutral) tribes. Grows as tribes are added; a run draws 5 of them. */
export const PLAYABLE_TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon'];
export const TRIBES_PER_RUN = 5;

/**
 * Pick a run's active tribes (handoff: only 5 tribes appear in a run at once).
 * Neutral glue is always available on top. With exactly 5 playable tribes today
 * this returns all of them (shuffled); it bounds the pool once more are added.
 */
export function selectRunTribes(rng: Rng): Tribe[] {
  const pool = [...PLAYABLE_TRIBES];
  const picks: Tribe[] = [];
  while (picks.length < TRIBES_PER_RUN && pool.length > 0) {
    picks.push(pool.splice(rng.int(pool.length), 1)[0]!);
  }
  return picks;
}

/** Deterministic 32-bit mix of a seed and a few small integers (FNV-1a style). */
export function mixSeed(...parts: number[]): number {
  let h = 0x811c9dc5 | 0;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h | 0;
}

export interface ShopCard {
  uid: string;
  cardId: string;
  /** Buffs applied to this offer while it's in the tavern (e.g. the hero power targeting
   *  a shop minion) — baked into the minion's stats/keywords when it's bought. */
  atk?: number;
  hp?: number;
  keywords?: Keyword[];
}

/** One source's contribution to a minion's recruit-phase buffs, accumulated for the inspect panel
 *  breakdown ("Spirit Fire ×2: +6/+6"). `count` = how many times that source buffed this card. */
export interface CardBuff {
  source: string;
  attack: number;
  health: number;
  count: number;
}

export interface BoardCard {
  uid: string;
  cardId: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  golden: boolean;
  /** Per-source recruit-phase stat buffs applied to this instance (Karwind, Nadir, Spirit Fire,
   *  Fortify, …) — drives the inspect-panel breakdown. Base stats are NOT recorded here. */
  buffs?: CardBuff[];
  /** Extra magnitude on this card's summon-buff effect, accrued permanently across the run
   *  (Kennelmaster's Avenge improvements). Default/absent = 0. */
  summonBonus?: number;
  /** Mana-per-turn this card grants *beyond* its own def (a Money Bot magnetized into it).
   *  The card's own `manaPerTurn` is read from its def; this holds only the absorbed bonus,
   *  so it survives the magnetize-merge + triple and is lost when the card is sold. */
  manaBonus?: number;
}

export type Phase = 'recruit' | 'combat' | 'gameover';

export interface RunState {
  seed: number;
  /** Current wave (Altitude). Score = waves survived. */
  wave: number;
  /** Deepest wave reached this run. */
  best: number;
  phase: Phase;
  embers: number;
  maxEmbers: number;
  resolve: number;
  maxResolve: number;
  tier: number;
  upgradeCost: number;
  frozen: boolean;
  shop: ShopCard[];
  /** The single tavern spell offered on the right of the shop (always present). */
  spell: ShopCard | null;
  /** Spells cast this run — drives spell-tracking minions. */
  spellsCast: number;
  /** Flat reduction to spell purchase costs (min 0) — drives "your spells cost less". */
  spellCostMod: number;
  /** Cards bought but not yet played (Battlegrounds hand). */
  hand: BoardCard[];
  board: BoardCard[];
  heroReady: boolean;
  threat: ThreatId;
  /** The 5 non-neutral tribes active this run (handoff: 5 tribes per run). */
  tribes: Tribe[];
  /** Advancing state of the shop RNG stream. */
  rngCursor: number;
  /** The shared, finite minion pool: cardId → copies remaining. The shop draws from it (a card at
   *  0 stops being offered) and sell / reroll return copies to it. Only buyable minions of the run's
   *  active tribes (+ neutral) are keyed here — tokens & spells are never pooled. */
  pool: Record<string, number>;
  /** Monotonic counter for shop/board instance uids. */
  uidSeq: number;
  /** Card ids queued to be injected into the *next* tavern refresh (Soulfeeder adds Fodder).
   *  Consumed (and possibly auto-eaten by your Demons) when the tavern next refreshes. */
  pendingTavern: string[];
  /** Persistent per-cardId stat buffs that apply to *every* copy of a card for the rest of the
   *  run, wherever it appears — tavern, hand, board, summoned, discovered (Ritualist buffs all
   *  Fodder this way). Baked in at every instantiation; the tavern display reads it live. */
  cardBuffs: Record<string, { attack: number; health: number }>;
  /** The most recent tavern-Fodder auto-consume, for the UI to replay (show the Fodder
   *  then swirl it into the eater). Carries the Fodder's *effective* stats (base + any
   *  Ritualist run buff) so the ghost shows what was actually eaten, not the 1/1 base.
   *  Transient. */
  fodderEaten?: { eaterUid: string; fodderId: string; attack: number; health: number }[];
  /** Bumps each time Fodder is auto-eaten — the UI keys its swirl animation off this. */
  fodderEatenSeq: number;
  /** Dragon uids Karwind just flame-buffed on the most recent Battlecry — the UI flashes flames
   *  on them (on top of the normal buff flash). Transient. */
  karwindFlash?: string[];
  /** Bumps each time Karwind flame-buffs — the UI keys its flame animation off this. */
  karwindFlashSeq: number;
  /** A pending Discover offer (3 card ids) granted by a triple — pick one to hand. */
  discover?: string[];
  /** A pending Choose One — a played card waiting for the player to pick an option. The
   *  options live on the card def (`CARD_INDEX[cardId].chooseOne`). */
  chooseOne?: { uid: string; cardId: string };
  /** The most recent combat's result, for the UI to replay. Transient. */
  lastCombat?: CombatResult;
}

export type Action =
  | { type: 'buy'; uid: string }
  | { type: 'play'; uid: string; toIndex?: number; targetUid?: string }
  | { type: 'sell'; uid: string }
  | { type: 'roll' }
  | { type: 'freeze' }
  | { type: 'upgrade' }
  | { type: 'reposition'; uid: string; toIndex: number }
  | { type: 'reorderShop'; uid: string; toIndex: number }
  | { type: 'heroPower'; uid: string }
  | { type: 'discover'; index: number }
  | { type: 'chooseOne'; index: number }
  | { type: 'faceOmen' }
  | { type: 'resolveCombat' };

/** Create a fresh run from a seed. Deterministic: same seed → same opening. */
export function createRun(seed: number): RunState {
  const tribes = selectRunTribes(makeRng(mixSeed(seed, 0, TAG.TRIBES)));
  const state: RunState = {
    seed,
    wave: 1,
    best: 1,
    phase: 'recruit',
    embers: CONFIG.startEmbers,
    maxEmbers: CONFIG.startEmbers,
    resolve: CONFIG.startResolve,
    maxResolve: CONFIG.startResolve,
    tier: 1,
    upgradeCost: CONFIG.upgradeCost[2] ?? 5,
    frozen: false,
    shop: [],
    spell: null,
    spellsCast: 0,
    spellCostMod: 0,
    hand: [],
    board: [],
    heroReady: true,
    threat: selectThreat(1, makeRng(mixSeed(seed, 1, TAG.THREAT))),
    tribes,
    rngCursor: mixSeed(seed, 0, TAG.SHOP),
    pool: stockPool(tribes),
    uidSeq: 0,
    pendingTavern: [],
    cardBuffs: {},
    fodderEatenSeq: 0,
    karwindFlashSeq: 0,
  };
  rollShop(state);
  return state;
}

/** Serialize for save-and-continue / shareable seeds (handoff C.9). */
export function serialize(state: RunState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): RunState {
  const state = JSON.parse(json) as RunState;
  if (!state.pool) state.pool = stockPool(state.tribes); // heal saves from before the finite pool
  return state;
}
