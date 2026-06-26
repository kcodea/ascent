import { makeRng } from '@game/core';
import type { CombatOutcome, CombatResult, Keyword, Rng, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
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
  /** Golden Touch: this offer buys in as a Golden (offer-level flag; the buy path bakes golden:true in). */
  golden?: boolean;
  /** Displacement: a board minion stashed here when swapped to the tavern — restored INTACT (all buffs /
   *  stats / progression) when re-bought or swapped back, rather than re-instantiated from base. */
  held?: BoardCard;
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
  /** Sergeant: accrued bonus on its Deathrattle HP grant, raised permanently EVERY time Sergeant gains
   *  Attack — in the shop (via addBuff) AND in combat (carried back). Seeds the combat instance + shown
   *  live on the card. Default/absent = 0. */
  hpGrantBonus?: number;
  /** Mana-per-turn this card grants *beyond* its own def (a Money Bot magnetized into it).
   *  The card's own `manaPerTurn` is read from its def; this holds only the absorbed bonus,
   *  so it survives the magnetize-merge + triple and is lost when the card is sold. */
  manaBonus?: number;
  /** Better Bot: accrued Rally-Mech Attack welded onto this card (5 per Better Bot magnetized, golden ×2).
   *  Carried into combat where, when this attacks, your other Mechs get +this Attack. */
  rallyMechAtk?: number;
  /** Harry Botter: accrued spell-power aura welded onto this card (1 per Harry Botter magnetized, golden ×2).
   *  Read by `spellStatBonus` alongside the card's own `spellAura`, so a welded host keeps boosting spells. */
  spellAuraBonus?: number;
  /** Maw of the Pit: a one-combat Divine Shield earned by consuming. The 'DS' keyword is added for
   *  display + the snapshot; this flag marks it temporary so `resolveCombat` strips it after the next
   *  fight (gain it again by consuming again). */
  tempShield?: boolean;
  /** The Reclaimer's mark: at the start of the next combat this minion is destroyed (its Deathrattle
   *  fires) and an exact copy is resummoned if there's room. Cleared each turn (re-choose). */
  resummon?: boolean;
  /** Spells cast while this card has been on the board — drives transform cards (Spirit Pup → Worgen
   *  at 10). Per-instance; ticks only while on the board (the spellCast trigger fires for the board). */
  spellProgress?: number;
  /** The wave this card was bought on — drives Hoarder's climbing sell value (currentWave - boughtWave
   *  + 1, ×2 golden). Set in the reducer's `buy` case; absent on cards from other sources (a Hoarder that
   *  wasn't bought sells for the base 1, since it has no held-since wave). */
  boughtWave?: number;
  /** Acid's per-instance refresh counter: how many times the shop has been rolled since this card entered
   *  the board. Fires the consume at every `every`-th roll. Reset to 0 in advanceCombat each wave. */
  rollTick?: number;
  /** End-of-Turn tick counter for cadence effects (Frontdrake: every 3 turns, get a Dragon). Advances
   *  once per turn this card is on the board (not per Chronos repeat). Per-instance; absent = 0. */
  eotTick?: number;
  /** Tara: accumulated stat-grants across combats (from `CombatResult.playerAscendCount`). At the card's
   *  `ascendAt` threshold it ascends to `ascendInto` in settleCombat, keeping its stats. */
  ascendProgress?: number;
}

export type Phase = 'recruit' | 'combat' | 'gameover' | 'victory';

/**
 * A serializable descriptor for one pending Discover, queued behind the currently-open offer
 * (`RunState.discover`). When the open Discover resolves, the next spec is shifted off
 * `RunState.discoverQueue` and opened. Kept as plain data (not a closure) so it survives save/load:
 * the `filter` is a string id resolved back to a predicate (`discoverFilter`) when the offer opens.
 *   • `{ kind: 'spell' }`            → a 3-random-spell Discover (offerSpellDiscover).
 *   • `{ kind: 'minion'; tier; filter? }` → a minion Discover (offerDiscover) up to `tier`, weighing every
 *      eligible card EVENLY (no high-tier bias — same rule as the shop + spell Discover). Options: a fixed
 *      `exactTier` (Sprout: only that tier), a card `filter` (Help Wanted: Battlecry minions only), and
 *      `topTierFirst` — the ONE high-tier exception, set only by the golden/triple reward ("peek one tier
 *      up"), which fills from the top tier down.
 */
export type DiscoverSpec =
  | { kind: 'spell' }
  | { kind: 'minion'; tier: number; exactTier?: number; filter?: 'battlecry' | 'deathrattle'; tribe?: Tribe; exclude?: string; topTierFirst?: boolean };

export interface RunState {
  seed: number;
  /** Game mode: 'ascent' (the scored climb) or 'practice' (a 15-round sandbox: any hero, unlimited health,
   *  3× shop timer, ends at round 15 regardless of W/L). Absent = 'ascent'. */
  mode?: 'ascent' | 'practice';
  /** Current wave (Altitude). Score = waves survived. */
  wave: number;
  /** Deepest wave reached this run. */
  best: number;
  /** Result of each combat resolved this run, in order — drives the end-screen W-L-W summary. */
  history: CombatOutcome[];
  phase: Phase;
  embers: number;
  maxEmbers: number;
  /** Total max-Gold Soulsman has earned this run (cumulative across combats) — surfaced on Soulsman's
   *  card as a "gained X Gold" metric. Absent on old saves = 0. */
  soulsmanGold?: number;
  /** Run-wide Imp buff (Fodder Feeder / Ritualist / Bane stack it). Applied to every friendly Imp in combat
   *  (imps are combat-summoned tokens — Brood Matron / Imp King), so the bonus follows them. Absent = 0/0. */
  impBuff?: { attack: number; health: number };
  /** Extra Gold granted at the start of next turn (Hoarder's Battlecry). Consumed when the next recruit
   *  turn's Gold is set, then cleared. Absent = 0. */
  bonusEmbersNextTurn?: number;
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
  /** Chrono Staff: this turn's End-of-Turn effects fire one extra time (a per-turn flag — stacks with
   *  Chronos, not with itself). Set on cast, reset at the next turn start. Absent = false. */
  extraEotThisTurn?: boolean;
  /** Steward of Spells: the id of the most recent spell cast this run (persists across turns until the next
   *  cast). Absent until a spell is cast. */
  lastSpellCastId?: string;
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
  /** Fleeting Vigor — a one-shot Start-of-Combat buff banked for the NEXT combat only (your minions enter
   *  that fight at +this; spent in `faceOmen`, win or lose). Absent = none. */
  fleetingVigor?: { attack: number; health: number };
  /** Run-wide Undead attack bonus (Lantern of Souls): your Undead get this much Attack everywhere —
   *  on the board in the shop and in every combat (incl. summoned/Reborn ones). */
  undeadAttackBonus: number;
  /** Run-wide Undead health bonus (Lantern of Souls' spell-power component). Paired with the attack
   *  bonus above and applied to the same Undead in the same places. */
  undeadHealthBonus: number;
  /** Run-wide Undead attack bonus AT BUY TIME (Deathswarmer / Forsaken Weaver): baked into each Undead
   *  card when it's bought, and re-applied on Reborn (Reborn resets to base stats). Separate from
   *  `undeadAttackBonus` (Lantern of Souls) which applies in combat only. */
  undeadBuyAtk: number;
  /** Run-wide SPELL POWER: extra +atk/+hp every stat-granting spell grants, on top of the hero's
   *  amplify (Spellbinder). Raised by cards — Cinderwing Matron (+1 Health on play), Skullblade
   *  (+1 Attack per combat death, carried back). Folded into `spellAttackBonus` / `spellHealthBonus`. */
  spellBonus: { attack: number; health: number };
  /** Staff of Guel — a run-wide buff baked onto every minion BOUGHT from the tavern (not Discovered or
   *  conjured). Persists for the rest of the run; stacks (and picks up spell power) if cast again. */
  tavernBuyBonus: { atk: number; hp: number };
  /** Drakko hero: Battlecry minions bought this run (his power grants Drakko the Drummer at 5). */
  drakkoBuys: number;
  /** Cassen hero: enemy minions killed since the last Collision payoff — at 5 it grants a minion of the
   *  board's most common tribe (then subtracts 5). Banks across combats until a minion can be granted. */
  cassenKills: number;
  /** Board power (Σ attack+health) captured at the START of the recruit turn — pins the telegraphed
   *  opponent match for the whole turn, so buying / selling / Hero Power can't re-roll the foe. */
  turnStartPower: number;
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
  /** Chaos hero: how many recruit turns have elapsed (incremented in faceOmen). Used to grant a
   *  Chaos Attachment every 4 turns. */
  heroPowerTick?: number;
  /** Fodder consumed so far this wave (reset in advanceCombat). The Abhorrent Horror reads this at
   *  Start of Combat to gain the fodder's stats. */
  fodderConsumedThisTurn?: { attack: number; health: number };
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
   *  then swirl it into the eater). `attack`/`health` are the Fodder's *effective* stats (base + any
   *  Ritualist run buff) so the ghost shows what was eaten, not the 1/1 base; `gainA`/`gainH` are what the
   *  eater actually GAINED (× its consume multiplier), so the UI can float the +X/+X on it. Transient. */
  fodderEaten?: { eaterUid: string; fodderId: string; attack: number; health: number; gainA: number; gainH: number }[];
  /** Bumps each time Fodder is auto-eaten — the UI keys its swirl animation off this. */
  fodderEatenSeq: number;
  /** Dragon uids Karwind just flame-buffed on the most recent Battlecry — the UI flashes flames
   *  on them (on top of the normal buff flash). Transient. */
  karwindFlash?: string[];
  /** Bumps each time Karwind flame-buffs — the UI keys its flame animation off this. */
  karwindFlashSeq: number;
  /** Chaos hero power: bumps each time a Chaos Attachment is granted (every 5th turn), with the new token's
   *  uid — the UI flies it in from the hero portrait. Transient; absent until the first grant. */
  chaosGrantSeq?: number;
  chaosGrantUid?: string;
  /** A pending Discover offer (3 card ids) — pick one to hand. */
  discover?: string[];
  /** Discovers queued behind the open one (`discover`). When a pick resolves, the next spec is shifted
   *  off and opened; `discover` only clears when this is empty. Fed by `queueDiscover` — e.g. a golden
   *  Black Belt Brian queues a 2nd spell Discover, Yazzus multiplies Help Wanted / Sprout, and a
   *  Drakko-doubled Brian queues one spell Discover per Battlecry fire. */
  discoverQueue?: DiscoverSpec[];
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
  | { type: 'heroPower'; uid?: string } // uid omitted for untargeted powers (Nadja's Mana Font)
  | { type: 'discover'; index: number }
  | { type: 'chooseOne'; index: number }
  | { type: 'battlecryTarget'; targetUid: string }
  | { type: 'faceOmen' }
  | { type: 'settleCombat' }
  | { type: 'resolveCombat' };

/** Create a fresh run from a seed. Deterministic: same seed → same opening. */
export function createRun(seed: number, heroId: string = DEFAULT_HERO_ID, mode: 'ascent' | 'practice' = 'ascent'): RunState {
  const tribes = selectRunTribes(makeRng(mixSeed(seed, 0, TAG.TRIBES)));
  // The hero's Resolve is the run's starting (and max) HP — all 30 today, diverging per hero later.
  const startResolve = getHero(heroId).resolve;
  const state: RunState = {
    seed,
    mode,
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
    undeadBuyAtk: 0,
    spellBonus: { attack: 0, health: 0 },
    tavernBuyBonus: { atk: 0, hp: 0 },
    drakkoBuys: 0,
    cassenKills: 0,
    turnStartPower: 0,
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
  if (heroId === 'chaos') {
    const def = CARD_INDEX['symbioticattachment'];
    if (def && state.hand.length < CONFIG.handMax) {
      state.hand.push({
        uid: `b${state.uidSeq++}`,
        cardId: 'symbioticattachment',
        tribe: def.tribe,
        attack: def.attack,
        health: def.health,
        keywords: [...def.keywords],
        golden: false,
      });
    }
  }
  return state;
}

/** Serialize for save-and-continue / shareable seeds (handoff C.9). */
export function serialize(state: RunState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): RunState {
  const state = JSON.parse(json) as RunState & { pendingSpellDiscovers?: number };
  if (!state.pool) state.pool = stockPool(state.tribes); // heal saves from before the finite pool
  state.cassenKills ??= 0; // heal saves from before Cassen's Collision tally
  state.turnStartPower ??= 0; // heal saves from before the pinned-opponent power
  state.spellBonus ??= { attack: 0, health: 0 }; // heal saves from before card-driven spell power
  state.undeadBuyAtk ??= 0; // heal saves from before Deathswarmer / Forsaken Weaver
  // Heal saves from before the generalized Discover queue: fold the old single spell-Discover counter
  // (golden Black Belt Brian) into the new queue as that many spell specs.
  if (state.pendingSpellDiscovers && state.pendingSpellDiscovers > 0) {
    state.discoverQueue = [
      ...(state.discoverQueue ?? []),
      ...Array.from({ length: state.pendingSpellDiscovers }, () => ({ kind: 'spell' as const })),
    ];
  }
  delete state.pendingSpellDiscovers;
  return state;
}
