import { makeRng } from '@game/core';
import type { CombatOutcome, CombatResult, Keyword, Rng, Tribe } from '@game/core';
import { CONFIG } from './config';
import { DEFAULT_HERO_ID, getHero } from './heroes';
import { rollShop, stockPool } from './shop';
import { selectThreat, type ThreatId } from './threats';

/**
 * Tags that separate the run's RNG streams. The shop stream advances with the
 * player's rolls (its cursor lives in RunState); the threat/enemy/combat streams
 * are derived purely from (seed, wave) so they're identical every time a wave is
 * re-resolved — which is why the recruit-phase preview matches the actual fight.
 */
export const TAG = { THREAT: 1, ENEMY: 2, SHOP: 3, COMBAT: 4, TRIBES: 5, MAGNET: 6, ODDS: 7 } as const;

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
  /** Maw of the Pit: a one-combat Divine Shield earned by consuming. The 'DS' keyword is added for
   *  display + the snapshot; this flag marks it temporary so `resolveCombat` strips it after the next
   *  fight (gain it again by consuming again). */
  tempShield?: boolean;
  /** Corrupted Lifebinder: the uid of the friendly demon it's linked to ("also gains the stats
   *  whenever that minion does"). Carried into combat so the simulator mirrors mid-fight gains too. */
  linkUid?: string;
  /** The linked demon's stats at link time — Lifebinder mirrors gains *beyond* this (recruit sync). */
  linkBase?: { attack: number; health: number };
  /** How much of the linked demon's recruit gain Lifebinder has already mirrored, so each sync applies
   *  only the new delta. */
  linkApplied?: { attack: number; health: number };
  /** The Reclaimer's mark: at the start of the next combat this minion is destroyed (its Deathrattle
   *  fires) and an exact copy is resummoned if there's room. Cleared each turn (re-choose). */
  resummon?: boolean;
  /** Spells cast while this card has been on the board — drives transform cards (Spirit Pup → Worgen
   *  at 10). Per-instance; ticks only while on the board (the spellCast trigger fires for the board). */
  spellProgress?: number;
}

export type Phase = 'recruit' | 'combat' | 'gameover' | 'victory';

export interface RunState {
  seed: number;
  /** Current wave (Altitude). Score = waves survived. */
  wave: number;
  /** Deepest wave reached this run. */
  best: number;
  /** Result of each combat resolved this run, in order — drives the end-screen W-L-W summary. */
  history: CombatOutcome[];
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
  /** Spells cast this turn (reset each wave) — scales Spirit Worgen's per-summon buff. */
  spellsThisTurn: number;
  /** Player-side Deathrattles triggered across the whole run — Grim's buff scales with this. */
  deathrattlesTriggered: number;
  /** Triples (goldens) formed across the whole run — captured in board snapshots as opponent intel. */
  triplesMade: number;
  /** True once the just-fought combat's outcome (damage + carry-backs) has been applied, while still in the
   *  combat view — so the Resolve hit lands before returning to the shop. Reset when a combat starts. */
  combatSettled: boolean;
  /** Free rerolls banked (Refreshing Texts) — a roll spends these before charging Mana. */
  freeRolls: number;
  /** Front to Back's accumulated escalation: each cast applies +(2 + this + spell power), then this += 2. */
  frontToBackBonus: number;
  /** Run-wide Undead attack bonus (Lantern of Souls): your Undead get this much Attack everywhere —
   *  on the board in the shop and in every combat (incl. summoned/Reborn ones). */
  undeadAttackBonus: number;
  /** Run-wide Undead health bonus (Lantern of Souls' spell-power component). Paired with the attack
   *  bonus above and applied to the same Undead in the same places. */
  undeadHealthBonus: number;
  /** Staff of Guel — a run-wide buff baked onto every minion BOUGHT from the tavern (not Discovered or
   *  conjured). Persists for the rest of the run; stacks (and picks up spell power) if cast again. */
  tavernBuyBonus: { atk: number; hp: number };
  /** Drakko hero: Battlecry minions bought this run (his power grants Drakko the Drummer at 5). */
  drakkoBuys: number;
  /** Cassen hero: enemy minions killed since the last Collision payoff — at 5 it grants a minion of the
   *  board's most common tribe (then subtracts 5). Banks across combats until a minion can be granted. */
  cassenKills: number;
  /** Flat reduction to spell purchase costs (min 0) — drives "your spells cost less". */
  spellCostMod: number;
  /** One-shot hint for the UI: Channeling the Devourer's stat projectile (who received it + how much).
   *  Set by the cast, read + cleared by the recruit screen after it animates. */
  devourFx?: { toUid: string; attack: number; health: number };
  /** Cards bought but not yet played (Battlegrounds hand). */
  hand: BoardCard[];
  board: BoardCard[];
  /** Which hero is being played (indexes the HEROES registry). */
  heroId: string;
  /** Per-wave hero power charge (once-per-wave powers like Fortify). */
  heroReady: boolean;
  /** Once-per-game hero powers (e.g. Oner's Gild) flip this and never recharge. */
  heroPowerSpent: boolean;
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
  /** A played minion with a *targeted* Battlecry (`CardDef.target === 'friendly'`, e.g. Toxin Tender),
   *  on the board and waiting for the player to pick the friendly minion its Battlecry hits. Resolved
   *  by `battlecryTarget`; auto-resolves on the carry if the turn ends first. */
  pendingTarget?: { uid: string; cardId: string };
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
  | { type: 'battlecryTarget'; targetUid: string }
  | { type: 'faceOmen' }
  | { type: 'settleCombat' }
  | { type: 'resolveCombat' };

/** Create a fresh run from a seed. Deterministic: same seed → same opening. */
export function createRun(seed: number, heroId: string = DEFAULT_HERO_ID): RunState {
  const tribes = selectRunTribes(makeRng(mixSeed(seed, 0, TAG.TRIBES)));
  // The hero's Resolve is the run's starting (and max) HP — all 30 today, diverging per hero later.
  const startResolve = getHero(heroId).resolve;
  const state: RunState = {
    seed,
    wave: 1,
    best: 1,
    history: [],
    phase: 'recruit',
    embers: CONFIG.startEmbers,
    maxEmbers: CONFIG.startEmbers,
    resolve: startResolve,
    maxResolve: startResolve,
    tier: 1,
    upgradeCost: CONFIG.upgradeCost[2] ?? 5,
    frozen: false,
    shop: [],
    spell: null,
    spellsCast: 0,
    spellsThisTurn: 0,
    deathrattlesTriggered: 0,
    triplesMade: 0,
    combatSettled: false,
    freeRolls: 0,
    frontToBackBonus: 0,
    undeadAttackBonus: 0,
    undeadHealthBonus: 0,
    tavernBuyBonus: { atk: 0, hp: 0 },
    drakkoBuys: 0,
    cassenKills: 0,
    spellCostMod: 0,
    hand: [],
    board: [],
    heroId,
    heroReady: true,
    heroPowerSpent: false,
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
  state.cassenKills ??= 0; // heal saves from before Cassen's Collision tally
  return state;
}
