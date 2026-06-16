import { makeRng } from '@game/core';
import type { CombatResult, Keyword, Rng, Tribe } from '@game/core';
import { CONFIG } from './config';
import { rollShop } from './shop';
import { selectThreat, type ThreatId } from './threats';

/**
 * Tags that separate the run's RNG streams. The shop stream advances with the
 * player's rolls (its cursor lives in RunState); the threat/enemy/combat streams
 * are derived purely from (seed, wave) so they're identical every time a wave is
 * re-resolved — which is why the recruit-phase preview matches the actual fight.
 */
export const TAG = { THREAT: 1, ENEMY: 2, SHOP: 3, COMBAT: 4, TRIBES: 5 } as const;

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
}

export interface BoardCard {
  uid: string;
  cardId: string;
  tribe: Tribe;
  attack: number;
  health: number;
  keywords: Keyword[];
  golden: boolean;
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
  /** Cards bought but not yet played (Battlegrounds hand). */
  hand: BoardCard[];
  board: BoardCard[];
  heroReady: boolean;
  threat: ThreatId;
  /** The 5 non-neutral tribes active this run (handoff: 5 tribes per run). */
  tribes: Tribe[];
  /** Advancing state of the shop RNG stream. */
  rngCursor: number;
  /** Monotonic counter for shop/board instance uids. */
  uidSeq: number;
  /** A pending Discover offer (3 card ids) granted by a triple — pick one to hand. */
  discover?: string[];
  /** The most recent combat's result, for the UI to replay. Transient. */
  lastCombat?: CombatResult;
}

export type Action =
  | { type: 'buy'; uid: string }
  | { type: 'play'; uid: string; toIndex?: number }
  | { type: 'sell'; uid: string }
  | { type: 'roll' }
  | { type: 'freeze' }
  | { type: 'upgrade' }
  | { type: 'reposition'; uid: string; toIndex: number }
  | { type: 'heroPower'; uid: string }
  | { type: 'discover'; index: number }
  | { type: 'faceOmen' }
  | { type: 'resolveCombat' };

/** Create a fresh run from a seed. Deterministic: same seed → same opening. */
export function createRun(seed: number): RunState {
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
    hand: [],
    board: [],
    heroReady: true,
    threat: selectThreat(1, makeRng(mixSeed(seed, 1, TAG.THREAT))),
    tribes: selectRunTribes(makeRng(mixSeed(seed, 0, TAG.TRIBES))),
    rngCursor: mixSeed(seed, 0, TAG.SHOP),
    uidSeq: 0,
  };
  rollShop(state);
  return state;
}

/** Serialize for save-and-continue / shareable seeds (handoff C.9). */
export function serialize(state: RunState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): RunState {
  return JSON.parse(json) as RunState;
}
