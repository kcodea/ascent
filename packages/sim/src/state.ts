import { makeRng } from '@game/core';
import type { CombatOutcome, CombatResult, EffectDef, Keyword, QuestObjectiveEvent, Rng, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CONFIG } from './config';
import { DEFAULT_HERO_ID, getHero } from './heroes';
import { queueDiscover } from './recruit';
import { rollShop, stockPool } from './shop';
import { selectThreat, type ThreatId } from './threats';

/**
 * Tags that separate the run's RNG streams. The shop stream advances with the
 * player's rolls (its cursor lives in RunState); the threat/enemy/combat streams
 * are derived purely from (seed, wave) so they're identical every time a wave is
 * re-resolved — which is why the recruit-phase preview matches the actual fight.
 */
export const TAG = { THREAT: 1, ENEMY: 2, SHOP: 3, COMBAT: 4, TRIBES: 5, MAGNET: 6, ODDS: 7, GILD: 8, QUEST: 9 } as const;

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
  /** Moe: a set discount price for this offer (a guaranteed Attachment costs 2 Gold). When present, the buy
   *  path charges this instead of the flat minion cost, and the UI shows a green price coin (a changed price). */
  cost?: number;
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
  /** Anomaly Reactor: extra tribes granted to THIS instance beyond its printed tribe(s) (a spell-added Mech
   *  type). Honored by `isTribe` (recruit synergies / magnetize / auras) and folded into the combat minion's
   *  `tribe2` at `instantiate`. Absent = none. */
  addedTribes?: Tribe[];
  /** Anomaly Reactor's "All" mode: this instance counts as EVERY tribe for the rest of the run — `isTribe`
   *  short-circuits true, and combat seeds `universalTribe` from it. */
  allTribes?: boolean;
  /** Per-source recruit-phase stat buffs applied to this instance (Karwind, Nadir, Spirit Fire,
   *  Fortify, …) — drives the inspect-panel breakdown. Base stats are NOT recorded here. */
  buffs?: CardBuff[];
  /** Extra magnitude on this card's summon-buff effect, accrued permanently across the run
   *  (Kennelmaster's Avenge improvements). Default/absent = 0. */
  summonBonus?: number;
  /** Flowing Monk: flat +X/+X on top of its stepped overflow grant — created by the TRIPLE combine (the
   *  golden starts at the SUM of the two highest copies' current grants). Default/absent = 0. */
  overflowBonus?: number;
  /** Sergeant: accrued bonus on its Deathrattle HP grant, raised permanently EVERY time Sergeant gains
   *  Attack — in the shop (via addBuff) AND in combat (carried back). Seeds the combat instance + shown
   *  live on the card. Default/absent = 0. */
  hpGrantBonus?: number;
  /** Gravetwin: the Deathrattle it copied from a targeted friendly Echo minion (the onDeath EffectDefs), fired at
   *  the start of the next shop if Gravetwin survived combat. `copiedEchoName` is the source's name for display. */
  copiedEcho?: EffectDef[];
  copiedEchoName?: string;
  /** Mana-per-turn this card grants *beyond* its own def (a Money Bot magnetized into it).
   *  The card's own `manaPerTurn` is read from its def; this holds only the absorbed bonus,
   *  so it survives the magnetize-merge + triple and is lost when the card is sold. */
  manaBonus?: number;
  /** Better Bot: accrued Rally-Mech Attack welded onto this card (5 per Better Bot magnetized, golden ×2).
   *  Carried into combat where, when this attacks, your other Mechs get +this Attack. */
  rallyMechAtk?: number;
  /** Perfect Core: accrued "Rally: get a random spell" welded onto this card (1 per Perfect Core magnetized,
   *  golden ×2). Carried into combat where, when this attacks, you get this-many random spells. */
  rallySpellWeld?: number;
  /** Count of Attachments (Magnetic minions) welded onto this card, incremented each `weldMagnetic`. Drives
   *  Blueprint Cache's End-of-Turn "give your Mechs +2/+2 for every Attachment they have". */
  attachments?: number;
  /** Harry Botter: accrued spell-power aura welded onto this card (1 per Harry Botter magnetized, golden ×2).
   *  Read by `spellStatBonus` alongside the card's own `spellAura`, so a welded host keeps boosting spells. */
  spellAuraBonus?: number;
  /** Heckbinder: accrued Fodder aura welded onto this card (+1/+2 per Heckbinder magnetized, golden ×2).
   *  Read by `fodderAuraLiveBonus` alongside the card's own `fodderAura`, so a welded host keeps enriching
   *  every new Fodder while it stays on the board. */
  fodderAuraBonus?: { attack: number; health: number };
  /** Maw of the Pit: a one-combat Divine Shield earned by consuming. The 'DS' keyword is added for
   *  display + the snapshot; this flag marks it temporary so `resolveCombat` strips it after the next
   *  fight (gain it again by consuming again). */
  tempShield?: boolean;
  /** Lord of the Risen's power: a one-combat Rise. The 'R' keyword is added for display + the snapshot;
   *  this flag marks it temporary so `settleCombat` strips it after the next fight. */
  tempReborn?: boolean;
  /** Bloodlust: a one-combat mark — at the start of the next combat this minion takes an immediate out-of-turn
   *  attack, immune to retaliation for that swing ("cannot die from that attack"). Stripped post-combat. */
  bloodlust?: boolean;
  /** Bloodbinder: which stat its Rally gives Fodder — alternates `undefined`/`'atk'` ↔ `'hp'` each turn (flipped
   *  at the start of each recruit turn). Seeded into combat; the Rally reads it. */
  bloodbinderMode?: 'atk' | 'hp';
  /** Bloodlust weld: the Bloodlust spell also grants its target a one-fight Rally — on each of its own attacks,
   *  give a random friendly minion Attack equal to its own. Carried into combat + stripped post-combat, like `bloodlust`. */
  bloodlustRally?: boolean;
  /** The Reclaimer's mark: at the start of the next combat this minion is destroyed (its Deathrattle
   *  fires) and an exact copy is resummoned if there's room. Cleared each turn (re-choose). */
  resummon?: boolean;
  /** Disco Dan: a hand card that cannot be PLAYED until you reach this shop tier (the T6/T4/T2 minions his
   *  Setlist Discovers on turn 1). Only THIS card is gated — the rest of the hand plays normally. The play
   *  action no-ops while `state.tier < lockedUntilTier`; the UI shows it locked. Cleared once it unlocks. */
  lockedUntilTier?: number;
  /** Ritualist: the accrued +A/+H its escalating End-of-Turn buff currently grants (grows by its `step` each
   *  trigger). Per-instance; drives `buffFodderImpsImproving`. Default/absent = 0. */
  eotBonus?: number;
  /** Spells cast while this card has been on the board — drives transform cards (Spirit Pup → Worgen
   *  at 10). Per-instance; ticks only while on the board (the spellCast trigger fires for the board). */
  spellProgress?: number;
  /** The wave this card was bought on — drives Hoarder's climbing sell value (currentWave - boughtWave
   *  + 1, ×2 golden). Set in the reducer's `buy` case; absent on cards from other sources (a Hoarder that
   *  wasn't bought sells for the base 1, since it has no held-since wave). */
  boughtWave?: number;
  /** Trail Forager: extra sell value accrued (+1 Gold per Beast played while it's on the board, ×2 golden).
   *  Read by `sellValueOf`; per-instance, persists across turns for the rest of the run. Absent = 0. */
  sellBonus?: number;
  /** Gold-spend meter for `goldSpent` effects (Acid, Banksly): accrues the Gold spent while this card is on
   *  the board, firing its payoff each time it crosses the threshold. Continuous across turns (carries the
   *  remainder), per-instance; absent = 0. */
  goldTick?: number;
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
  | { kind: 'minion'; tier: number; exactTier?: number; filter?: 'battlecry' | 'deathrattle'; tribe?: Tribe; tribes?: Tribe[]; exclude?: string; topTierFirst?: boolean; lockTier?: number }
  // A Discover from an EXPLICIT card-id pool (Rune of the Second Path's Greater-Quest reward minions).
  | { kind: 'pool'; ids: string[] };

/** A quest the player has bought — its live objective progress + completion flag. Persists for the run
 *  (shown in the quest panel); up to 3 accumulate over a run (waves 4/8/12). */
export interface ActiveQuest {
  questId: string;
  progress: number;
  completed: boolean;
  /** The Author's Hand compound objective: per-key progress toward the shared `count` (Shout / Echo / Rally each).
   *  `progress` mirrors the min of the three for the panel bar. Absent for normal single-count objectives. */
  subProgress?: { shout: number; echo: number; rally: number };
  /** A general compound objective (`event: 'compound'`): per-part progress, index-aligned with `objective.parts`.
   *  Each part has its own count; the quest completes when all parts fill. `progress` = Σ part progress (bar). */
  partProgress?: number[];
}

export interface RunState {
  seed: number;
  /** Game mode: 'ascent' (the scored climb) or 'practice' (the SAME course — any hero, unlimited health,
   *  3× shop timer — so it reads identically to Ascent; ends at `courseRounds` regardless of W/L, unscored).
   *  Absent = 'ascent'. */
  mode?: 'ascent' | 'practice';
  /** Current wave (Altitude). Score = waves survived. */
  wave: number;
  /** Result of each combat resolved this run, in order — drives the end-screen W-L-W summary. */
  history: CombatOutcome[];
  /** Par (A2): the target number of scored wins for this run — cover or beat it. Set at run start (static
   *  today; becomes rating-driven with the career system). See `lineResult`. */
  line: number;
  phase: Phase;
  embers: number;
  maxEmbers: number;
  /** Permanent max-Gold bonus ABOVE the per-wave curve/cap (Shop License's `gainMaxGold`). Unlike a raw
   *  `maxEmbers` bump — which the per-wave `Math.max(maxEmbers, min(cap, …))` re-levels to the cap when it's
   *  below it — this is added on top of the capped value every turn, so a below-cap grant stays permanent. */
  maxGoldBonus?: number;
  /** Total max-Gold Soulsman has earned this run (cumulative across combats) — surfaced on Soulsman's
   *  card as a "gained X Gold" metric. Absent on old saves = 0. */
  soulsmanGold?: number;
  /** Run-wide Imp buff (Fodder Feeder / Ritualist / Bane stack it). Applied to every friendly Imp in combat
   *  (imps are combat-summoned tokens — Brood Matron / Imp King), so the bonus follows them. Absent = 0/0. */
  impBuff?: { attack: number; health: number };
  /** Extra Gold granted at the start of next turn (Hoarder's Battlecry / Safety Deposit Box / Robin's
   *  Spoils). Consumed when the next recruit turn's Gold is set, then cleared. Absent = 0. */
  bonusEmbersNextTurn?: number;
  /** Pre-emptive Assault: the player's board attacks first in the NEXT combat, overriding the
   *  more-minions initiative rule (ties included). One-shot — cleared in `settleCombat`. */
  attackFirstNext?: boolean;
  /** Rallying Offensive: your Rally effects trigger twice in the NEXT combat. One-shot — does not stack
   *  (a bool), cleared in `settleCombat`. */
  rallyDoubleNext?: boolean;
  /** Nimbus: a charge that makes the NEXT Tavern spell cast twice (×3 if Nimbus was golden). Read by
   *  `spellCasts`, spent by the reducer on the next real (non-singleCast) spell cast; persists across turns
   *  until used (NOT cleared at settle, unlike the combat one-shots above). */
  nextSpellMult?: number;
  /** Gold spent during the CURRENT recruit turn (buys, rerolls, tier-ups, hero powers) — Patch Job scales off
   *  it (+3/+3 per 7 Gold). Accrued in `spendGold`, reset to 0 each turn in the wave-advance. Distinct from
   *  the lifetime `goldSpent` career stat. */
  goldSpentThisTurn?: number;
  /** Minion cardIds PLAYED this recruit turn (normal plays) — Pack Leader (SoC, via a simulate param) and
   *  Spirit Worgen (End of Turn) scale off "Beasts/Dragons you played this turn". Reset each turn. */
  playedThisTurn?: string[];
  /** Combo: true when the LAST card played was a Primer — the next card played fires its Combo (if it has one).
   *  Set on every play to `def.primer`; a Combo card checks it, then it re-arms based on the card just played. */
  comboArmed?: boolean;
  resolve: number;
  maxResolve: number;
  /** Armor — extra effective HP on top of Resolve. Loss damage chips Armor first, then Resolve; it doesn't
   *  regenerate (no heal touches it). Set from the hero at run start. `maxArmor` is the starting value, kept
   *  for the HUD's stacked HP bar. */
  armor: number;
  maxArmor: number;
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
  /** Total Gold spent across the run (buys, rerolls, tier-ups, hero powers) — a career/post-run stat. */
  goldSpent: number;
  /** Combat contribution across the run (see `contribution.ts`): per-card attack damage (→ MVP minion) and
   *  mechanic-trigger counts (→ most-triggered mechanic). Accumulated in `settleCombat`. */
  runDamage: Record<string, { name: string; damage: number }>;
  runProcs: Record<string, number>;
  /** True once the just-fought combat's outcome (damage + carry-backs) has been applied, while still in the
   *  combat view — so the Resolve hit lands before returning to the shop. Reset when a combat starts. */
  combatSettled: boolean;
  /** Free rerolls banked (Refreshing Texts) — a roll spends these before charging Mana. */
  freeRolls: number;
  /** Moe: number of upcoming shops that must contain a guaranteed Magnetic offer. Each `rollShop` forces one in
   *  (if none rolled naturally) and decrements this. */
  guaranteedAttachmentShops?: number;
  /** Front to Back's accumulated escalation, INDEPENDENT per stat (owner 2026-07-09): the Attack side lives here,
   *  the Health side in `frontToBackBonusH`. Each cast grants +(step + this + that stat's spell power) and
   *  improves this by (step + that stat's spell power). A missing Health field on an old save heals to 0. */
  frontToBackBonus: number;
  frontToBackBonusH: number;
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
  /** Run-wide Beast attack bonus (Squirl Scout): your Beasts get this much Attack everywhere — baked into a
   *  Beast when it's created, and re-applied on Reborn/summon (from-base combat bodies). Beast sibling of
   *  `undeadBuyAtk`. */
  beastBuyAtk: number;
  /** Run-wide Beast HEALTH aura (Pack Mentality quest): your Beasts get this much Health everywhere — the
   *  Health sibling of `beastBuyAtk`, baked in on creation + re-applied on Reborn/summon. Absent-safe (0). */
  beastBuyHp: number;
  /** Squirl Scout's run-wide grant size: each Squirl Scout played raises it +3 (×2 golden). Its Battlecry
   *  gives a random friendly minion +this/+this once per Beast you own. Absent-safe (0). */
  squirlScoutBuff?: number;
  /** Run-wide Magnetic/Attachment aura (Scrap Herald): your Magnetic minions get +magneticBuyAtk/+magneticBuyHp
   *  everywhere — baked in on creation, re-applied on Reborn/summon. The only tribe-style aura with a Health half. */
  magneticBuyAtk: number;
  magneticBuyHp: number;
  /** Run-wide SPELL POWER: extra +atk/+hp every stat-granting spell grants, on top of the hero's
   *  amplify (Spellbinder). Raised by cards — Cinderwing Matron (+1 Health on play), Skullblade
   *  (+1 Attack per combat death, carried back). Folded into `spellAttackBonus` / `spellHealthBonus`. */
  spellBonus: { attack: number; health: number };
  /** Staff of Guel — a run-wide buff baked onto every minion BOUGHT from the tavern (not Discovered or
   *  conjured). Persists for the rest of the run; stacks (and picks up spell power) if cast again. */
  tavernBuyBonus: { atk: number; hp: number };
  /** Apples (Choose One) — a one-shot buff folded into the offers of the NEXT tavern roll (refresh or turn
   *  advance), then cleared. Stacks if cast more than once before the next roll. */
  nextShopBuff?: { attack: number; health: number };
  /** Drakko hero: Battlecry minions bought this run (his power grants Drakko the Drummer at 5). */
  drakkoBuys: number;
  /** Chronos hero: End-of-Turn minions bought this run (his Encore quest grants a Chronos at 4). */
  eotMinionBuys?: number;
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
  /** Indy's Gild: the cumulative `goldSpent` value at which the (spent) Gild charge recharges — set to
   *  `goldSpent + 40` on each use, cleared when the threshold is reached (see `spendGold`). Absent until first use. */
  indyGildRearmAt?: number;
  /** Total hero-power activations this game — gates powers with a `maxUses` cap (Gildmaster: 2 total,
   *  still once per turn). Absent = 0. Never reset (a whole-game budget, unlike `heroReady`). */
  heroPowerUses?: number;
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
  /** Fodder scheduled across the next SEVERAL tavern refreshes (Soulfeeder / Pit Supplier: "add N Fodder to the
   *  next 2 shops"). `fodderSchedule[i]` = Fodder due at the refresh `i` from now; each refresh consumes index 0
   *  (dumping it into `pendingTavern`) and shifts the rest down. */
  fodderSchedule?: number[];
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
  /** The quest shop is open (waves 4/8/12): a pending offer of quest ids to "buy" for 0 Gold. While set, the
   *  reducer blocks every non-`buyQuest` action (the tavern is locked) and the UI pauses the round timer; the
   *  bought quest moves to `activeQuests` and this clears, opening the normal shop. */
  questOffer?: string[];
  /** Quests the player has bought this run, with live objective progress — rendered in the quest panel.
   *  Optional so pre-quest-system saves heal to `[]` rather than crashing on read. */
  activeQuests?: ActiveQuest[];
  /** Warm Embers quest: your next N Shouts (Battlecry minions you play) each trigger twice. Consumed one per
   *  played Battlecry while > 0 (folds a +1 into that play's repeat count). Absent = 0. */
  shoutDoubleCharges?: number;
  /** Quest rewards scheduled to fire again later (Trail Rations' "repeat in 2 turns"). Each recruit-turn
   *  setup ticks `turnsLeft` down; at 0 the quest's reward re-applies (without re-scheduling). Absent = none. */
  pendingQuestRewards?: { questId: string; turnsLeft: number }[];
  /** Card ids to conjure to hand at the END OF EACH TURN for the rest of the run (Feed the Alpha's recurring
   *  reward — one Feed the Alpha spell per turn). Multiple quests append; absent = none. */
  questRecurringGrants?: string[];
  /** Growing tribe auras from quests (Pack Mentality): +stepAttack/+stepHealth to the tribe's aura each time
   *  `per` of `event` accrues over the run. `progress` carries the leftover between steps. Absent = none. */
  questScalingAuras?: { tribe: Tribe; per: number; event: QuestObjectiveEvent; stepAttack: number; stepHealth: number; progress: number }[];
  /** Den Marker (quest): a run-wide Den-Mother aura — every Beast you play/summon gains +attack/+health, and that
   *  magnitude climbs +step/+step every `per` Beasts (`count` carries progress toward the next step). Absent = none. */
  denMarker?: { attack: number; health: number; step: number; per: number; count: number };
  /** Run-wide combat modifiers armed by completed quests (Blood Trail / Echoing Coop / Law of Teeth / The Old
   *  Hunt) — merged with the live Beast aura and threaded into `simulate()` each fight. `oldHunt` stores the
   *  per-Beast-attack aura step. Absent = none armed. */
  questFlags?: { bloodTrail?: boolean; echoingCoop?: boolean; lawOfTeeth?: boolean; oldHunt?: number; deepHunger?: boolean; contractRewrite?: boolean; doubleLeftmostAttack?: boolean; feedingLine?: boolean; umbralEnergy?: boolean; emptyGraves?: boolean; assemblyLine?: number; runeWarding?: boolean; runeFury?: boolean; runeSlaying?: boolean; runeForthcoming?: boolean; runeRallying?: boolean; runeRisingGraves?: boolean; runeBroodpit?: boolean; runeSpearline?: boolean; runeAppraisal?: boolean; runeSoulTaxes?: boolean; runeFirstClaws?: boolean; runePackcraft?: boolean; runeInheritance?: boolean; runeSalvage?: boolean; runeTwilight?: boolean; runeWarden?: boolean };
  // ── Runeforge (Runesmith) ──
  /** The Runeforge is open (turn 6): a pending offer of rune ids to buy for their Gold cost. Like `questOffer`,
   *  while set the reducer blocks every non-`buyRune`/`skipRuneforge` action and the UI pauses the timer; buying
   *  (or skipping) clears it. Opens exactly once (the hero power is `oncePerGame`). */
  runeforgeOffer?: string[];
  /** The Runeforge's single re-roll (2 Gold) has been used this visit — the offer can't be re-rolled again. */
  runeforgeRerolled?: boolean;
  /** The open forge is the EPIC Runeforge (drawn from `EPIC_RUNES`, opened by a quest — not the Runesmith's
   *  hero-power forge). Drives the reroll pool, the "Epic" UI label, and skips consuming the hero-power charge. */
  runeforgeEpic?: boolean;
  /** A completed quest (The Epic Runeforge) has armed the Epic Runeforge — it opens at the START of the next turn
   *  (`advanceCombat`), not immediately, so the forge modal doesn't interrupt the turn it completed on. */
  pendingEpicRuneforge?: boolean;
  /** A forge armed MID-TURN (Epic, by a quest) is deferred until the next turn's start — `advanceCombat` clears
   *  this, and until then `openNextStartOfTurnModal`'s mid-turn drains skip it (owner bug 2026-07-13). */
  pendingForgeDeferred?: boolean;
  /** The Runeforge quest armed a BASIC Runeforge visit for next turn (any hero), granting `gold` that turn.
   *  `deferred` mirrors `pendingForgeDeferred` for the basic forge (armed mid-turn → wait for next turn's start). */
  pendingBasicForge?: { gold?: number; deferred?: boolean };
  /** Rune of the Epic Forge: open the Epic Runeforge when the run reaches this wave (turn 9). */
  epicForgeWave?: number;
  /** The open forge is quest-/rune-scheduled (not the Runesmith hero power) — buying/skipping spends no charge. */
  runeforgeNoCharge?: boolean;
  /** Rune of Kindling: each spell you cast gives your leftmost minion +3/+3. */
  runeKindling?: boolean;
  /** Rune of Scales: each spell you cast gives your Dragons +1/+1 (board + hand). */
  runeScales?: boolean;
  /** Rune of Bartering: your Shout (Battlecry) minions sell for 2 Gold. */
  runeBartering?: boolean;
  /** Rune of Twin Gilding: you only need 2 copies of a card to Gild (triple) it. */
  runeTwinGilding?: boolean;
  /** Rune of the Den Mother: your Den Mother also buffs herself when she buffs another Beast. */
  runeDenMother?: boolean;
  /** Rune ids bought this run — shown as permanent run-buff badges (above the hero panel). */
  ownedRunes?: string[];
  /** Rune of Spellslinging: every `spellDripPer` Gold spent, get a random spell. `spellDripTick` carries the
   *  sub-`per` Gold remainder. Absent = not owned. */
  spellDripPer?: number;
  spellDripTick?: number;
  /** Rune of Structure: each Attachment (Magnetic) you PLAY from hand also gives a random spell. */
  runeStructure?: boolean;
  /** Rune of Consumption: every Fodder Consumed bumps the run-wide Fodder aura by this much. Absent = not owned. */
  runeConsume?: { attack: number; health: number };
  /** Rune of Pillaging: your Gold Pouches (the Gold Pouch spell) are worth this many Gold. Absent = default 1. */
  goldPouchValue?: number;
  /** Rune of Summoning: each spell cast improves your Imps +1/+1 (run-wide, via the Imp enchant). */
  runeSummoning?: boolean;
  /** Rune of Empowerment (Epic): your hero power's effect triggers twice. Threaded as a `reps` multiplier into
   *  the value/generate powers (scalingGold / gainMaxMana / fortify / dynamiteDig). */
  runeEmpowerment?: boolean;
  /** Rune of Scale (Epic): every Gold-spend gives `count` random board minions +attack/+health. */
  runeScale?: { count: number; attack: number; health: number };
  /** Rune of Copies (Epic): copy a random board minion to hand at the start of every turn. */
  runeCopies?: boolean;
  /** Food for Gold (Demon greater): armed reward — every `per` Gold spent adds a Fodder to the next shop and
   *  bumps the run-wide Fodder aura by +attack/+health. `foodForGoldTick` carries the sub-`per` Gold remainder. */
  foodForGold?: { per: number; attack: number; health: number };
  foodForGoldTick?: number;
  /** Twin Sun Oath (Dragon capstone): every Shout you trigger buffs your leftmost + rightmost board minion by
   *  this much (+atk/+hp), for the rest of the run. Absent = not armed. */
  shoutEdgeBuff?: { attack: number; health: number };
  /** Dragon Shout rewards. `shoutExtraAlways` = permanent extra Battlecry triggers (Hoardwake / The Hoard Wakes,
   *  stacks like Drakko). `shoutFirstDoubleEachRound` = the first Shout you play each turn triggers twice (Warm
   *  Embers); `shoutFirstUsedThisTurn` tracks whether that turn's freebie is spent. Absent = off. */
  shoutExtraAlways?: number;
  shoutFirstDoubleEachRound?: boolean;
  shoutFirstUsedThisTurn?: boolean;
  /** Transient: how many times the LAST played Battlecry fired (Drakko + shout-repeat rewards + charges) — set
   *  during the play, read by the reducer's Shout quest tick so it counts triggers without re-consuming. */
  lastShoutFires?: number;
  /** Transient: how many Echoes (Deathrattles) fired OUT OF COMBAT this action (Grave Robber / Gravetwin / Crypt
   *  Broker / Sylus re-fires) — accumulated by `fireRecruitDeathrattles`, drained by the reducer's `deathrattle`
   *  quest tick so a recruit-phase Echo counts toward Echo quests just like a combat one. */
  lastEchoFires?: number;
  /** Transient: how many End-of-Turn effect triggers fired this End of Turn (incl. Chronos/Parliament repeats +
   *  quest recurring effects) — set by `applyEndOfTurn`, read by the reducer's End-of-Turn quest tick. */
  lastEotFires?: number;
  /** Parliament of Flame: permanent extra End-of-Turn triggers (stacks like Chronos). Folds into endOfTurnRepeats. */
  endOfTurnExtra?: number;
  /** Undead Echo rewards (fold into QuestCombatMods for `simulate`). `echoExtraAlways` = permanent extra Echo
   *  triggers (Funeral Engine, stacks like Sylus). `echoFirstEachCombat` = extra fires for the FIRST Echo each
   *  combat (Grave Contract + Last Rites, additive). `boneThroneStep` = every-N-deaths leftmost-Echo trigger. */
  echoExtraAlways?: number;
  echoFirstEachCombat?: number;
  boneThroneStep?: number;
  /** Mech/neutral Rally rewards (fold into QuestCombatMods). `rallyExtraAlways` = permanent extra Rally triggers
   *  (Infinite Assembly). `rallyFirstEachCombat` = extra fires for the first Rally each combat (Spark Permit /
   *  Overclocked Core, additive). `sharedCircuitWard` = Shared Circuit's SoC Ward count. */
  rallyExtraAlways?: number;
  rallyFirstEachCombat?: number;
  sharedCircuitWard?: number;
  /** Demon quests. `runFodderConsumed` = run-wide Fodder-Consumed totals (count + Σ stats) feeding `consumeFodder`
   *  / `consumeStats`. `pitWithoutEndImps` = Pit Without End's board-wipe Imp count. */
  runFodderConsumed?: { count: number; stats: number };
  /** Set when a turn-setup tavern roll injected Fodder but DEFERRED the Demon consume (because a start-of-turn
   *  modal — quest offer / Runeforge — is open). `openNextStartOfTurnModal` runs the consume once every modal
   *  clears, so the player sees the Fodder in the shop before their Demons eat it (owner 2026-07-13). */
  holdFodderConsume?: boolean;
  pitWithoutEndImps?: number;
  /** Rulebreaker (neutral) quest rewards. `dupeFirstBuyEachTurn` = the first minion bought each turn is copied to
   *  hand (`dupeUsedThisTurn` tracks the per-turn spend). `spellDoubleAlways` = every spell casts twice (Ancient
   *  Runes); `spellFirstDoubleEachTurn` = the first spell each turn casts twice (Spell Thesis, `spellFirstUsedThisTurn`
   *  tracks it). `minionCostOverride` = shop minion cost (Merchant's Mark). `slaughterFirstEachCombat` = Author's
   *  Hand's first-Slaughter doubler (fed into QuestCombatMods). */
  dupeFirstBuyEachTurn?: boolean;
  dupeUsedThisTurn?: boolean;
  spellDoubleAlways?: boolean;
  spellFirstDoubleEachTurn?: boolean;
  spellFirstUsedThisTurn?: boolean;
  minionCostOverride?: number;
  slaughterFirstEachCombat?: number;
  /** Attachment Issues (Mech capstone): every shop is guaranteed a Magnetic offer (`alwaysAttachmentShop`) and
   *  every Magnetic offer's price is set to `attachmentCost` Gold — both permanent once armed. */
  attachmentCost?: number;
  alwaysAttachmentShop?: boolean;
  /** Fried Circuits (Mech capstone): armed step + purchase counter — each minion bought buffs every Mech shop
   *  offer by `(stepAtk/stepHp) × buys` (escalating). */
  friedCircuitsStepAtk?: number;
  friedCircuitsStepHp?: number;
  friedCircuitsBuys?: number;
  /** Forsaken Will (Undead greater): armed — each spell cast grants your Undead aura +this Attack (folds into
   *  `undeadAttackBonus`, which applies in the shop AND combat). */
  forsakenWillAttack?: number;
  /** Transient: cardIds of the player minions that survived the LAST combat (from CombatResult). Read at the
   *  next shop start to fire a surviving Gravetwin's copied Echo. Reset each wave. */
  lastSurvivorCardIds?: string[];
  /** Recurring End-of-Turn effects granted by quests (Echoing Roar → re-fire leftmost Shout; The Hoard Wakes →
   *  conjure a random Shout minion). Fired every End of Turn for the rest of the run. Absent = none. */
  questRecurringEndOfTurn?: ('triggerLeftmostShout' | 'grantRandomShout' | 'grantRandomAttachments' | 'buffMechsPerAttachment' | 'runeSpending' | 'runeAction' | 'triggerLeftmostEcho' | 'weldMoneyBotsEdgeMechs')[];
  /** A pending Discover offer (3 card ids) — pick one to hand. */
  discover?: string[];
  /** Disco Dan's Setlist: the shop tier the CURRENTLY-open Discover's pick will be locked until (its
   *  `lockedUntilTier`). Set by `openDiscover` from the spec's `lockTier`, read + cleared when the pick
   *  resolves. Undefined for every normal Discover. */
  discoverLockTier?: number;
  /** Discovers queued behind the open one (`discover`). When a pick resolves, the next spec is shifted
   *  off and opened; `discover` only clears when this is empty. Fed by `queueDiscover` — e.g. a golden
   *  Black Belt Brian queues a 2nd spell Discover, Yazzus multiplies Help Wanted / Sprout, and a
   *  Drakko-doubled Brian queues one spell Discover per Battlecry fire. */
  discoverQueue?: DiscoverSpec[];
  /** A pending Choose One — a played card waiting for the player to pick an option. The options live on the
   *  card def (`CARD_INDEX[cardId].chooseOne`). `spell` marks a SPELL choose-one (its own thing, not a
   *  battlecry): the card is still in HAND and its chosen effect is cast (then consumed) on pick. `targetUid`
   *  is set for a *targeted* spell Choose One (Anomaly Reactor): the drag already picked the target minion, so
   *  the chosen option's effect is cast ON that target rather than untargeted. */
  chooseOne?: { uid: string; cardId: string; spell?: boolean; targetUid?: string };
  /** A played minion with a *targeted* Battlecry (`CardDef.target === 'friendly'`, e.g. Toxin Tender),
   *  on the board and waiting for the player to pick the friendly minion its Battlecry hits. Resolved
   *  by `battlecryTarget`; auto-resolves on the carry if the turn ends first. `optionIndex` marks a deferred
   *  *targeted Choose One* (Runic Beetle) — the chosen option's effects resolve on the picked target. */
  pendingTarget?: { uid: string; cardId: string; optionIndex?: number; bothOptions?: boolean };
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
  | { type: 'reorderHand'; uid: string; toIndex: number }
  | { type: 'heroPower'; uid?: string } // uid omitted for untargeted powers (Nadja's Mana Font)
  | { type: 'discover'; index: number }
  | { type: 'buyQuest'; index: number } // quest shop (waves 4/8/12): "buy" the offered quest at `index` for 0 Gold
  | { type: 'buyRune'; index: number } // Runeforge (turn 6): buy the offered rune at `index` for its Gold cost
  | { type: 'skipRuneforge' } // Runeforge: leave without buying (closes the forge)
  | { type: 'rerollRuneforge' } // Runeforge: re-roll the offered runes once, for 2 Gold
  | { type: 'chooseOne'; index: number }
  | { type: 'battlecryTarget'; targetUid: string }
  | { type: 'faceOmen' }
  | { type: 'settleCombat' }
  | { type: 'resolveCombat' };

/** The automatic combat-flow transitions — they fire ~once per round regardless of how the player
 *  builds, so they're excluded from the "actions per round" stat (which measures player decisions). */
const COMBAT_FLOW_ACTIONS = new Set<Action['type']>(['faceOmen', 'settleCombat', 'resolveCombat']);
/** Is this a player-initiated decision (buy / sell / play / roll / freeze / tier-up / reposition /
 *  discover / choose / hero power / targeting) vs. an automatic combat-flow transition? Basis for APT. */
export const isPlayerAction = (a: Action): boolean => !COMBAT_FLOW_ACTIONS.has(a.type);

/** A run's W–L record over the SCORED rounds only (A1). The first `CONFIG.calibrationRounds` rounds are
 *  calibration and don't count; draws are excluded from both wins and losses. `history[i]` is round i+1's
 *  result, so scored results = `history.slice(calibrationRounds)`. */
export function runRecord(state: RunState): { wins: number; losses: number; draws: number } {
  let wins = 0, losses = 0, draws = 0;
  for (const r of state.history.slice(CONFIG.calibrationRounds)) {
    if (r === 'win') wins++;
    else if (r === 'lose') losses++;
    else draws++;
  }
  return { wins, losses, draws };
}

/** Whether a given round (1-based wave) is a calibration round — the opening rounds that don't count
 *  toward the record (they still cost Resolve + run the economy). */
export function isCalibrationRound(wave: number): boolean {
  return wave <= CONFIG.calibrationRounds;
}

/** How a run graded against its par (A2). Par is the win condition: covering it is a win even if you
 *  then fell before the final round. `covered` = met the line exactly, `exceeded` = beat it, `flawless`
 *  = won every scored round. Falling short is a loss: `failed` = under par *and* died (Resolve 0) before
 *  finishing the course, `missed` = under par but survived to the end. `delta` = scored wins − line. */
export type LineStatus = 'flawless' | 'exceeded' | 'covered' | 'missed' | 'failed';
export function lineResult(state: RunState): { line: number; wins: number; delta: number; status: LineStatus } {
  const { wins } = runRecord(state);
  const line = state.line;
  const delta = wins - line;
  const scoredRounds = CONFIG.courseRounds - CONFIG.calibrationRounds;
  let status: LineStatus;
  if (wins >= scoredRounds) status = 'flawless';
  else if (wins > line) status = 'exceeded';
  else if (wins >= line) status = 'covered';
  // Under par — a loss. Distinguish dying early (`failed`) from surviving the course short (`missed`).
  else status = state.phase === 'gameover' ? 'failed' : 'missed';
  return { line, wins, delta, status };
}

/** Did the run cover its par? `covered` / `exceeded` / `flawless` are wins; `missed` / `failed` are losses.
 *  The single source of truth for "was this run a win" across the end screen, Career, and build tags. */
export const metLine = (status: LineStatus): boolean =>
  status === 'covered' || status === 'exceeded' || status === 'flawless';

/** Create a fresh run from a seed. Deterministic: same seed → same opening. `line` is the run's par (the
 *  rating system passes the player's rating-derived Line; defaults to CONFIG.defaultLine so callers that
 *  don't track rating — tests, tools, the boot throwaway — keep the historic mid-tier Line 9). */
export function createRun(seed: number, heroId: string = DEFAULT_HERO_ID, mode: 'ascent' | 'practice' = 'ascent', line: number = CONFIG.defaultLine): RunState {
  const tribes = selectRunTribes(makeRng(mixSeed(seed, 0, TAG.TRIBES)));
  // The hero's Resolve is the run's starting (and max) HP; Armor is extra effective HP layered on top.
  const hero = getHero(heroId);
  const startResolve = hero.resolve;
  const state: RunState = {
    seed,
    mode,
    wave: 1,
    history: [],
    line,
    phase: 'recruit',
    embers: CONFIG.startEmbers,
    maxEmbers: CONFIG.startEmbers,
    resolve: startResolve,
    maxResolve: startResolve,
    armor: hero.armor,
    maxArmor: hero.armor,
    tier: 1,
    upgradeCost: CONFIG.upgradeCost[2] ?? 5,
    frozen: false,
    shop: [],
    spell: null,
    spellsCast: 0,
    spellsThisTurn: 0,
    deathrattlesTriggered: 0,
    triplesMade: 0,
    goldSpent: 0,
    runDamage: {},
    runProcs: {},
    combatSettled: false,
    freeRolls: 0,
    frontToBackBonus: 0,
    frontToBackBonusH: 0,
    undeadAttackBonus: 0,
    undeadHealthBonus: 0,
    undeadBuyAtk: 0,
    beastBuyAtk: 0,
    beastBuyHp: 0,
    magneticBuyAtk: 0,
    magneticBuyHp: 0,
    spellBonus: { attack: 0, health: 0 },
    tavernBuyBonus: { atk: 0, hp: 0 },
    drakkoBuys: 0,
    cassenKills: 0,
    turnStartPower: 0,
    spellCostMod: 0,
    hand: [],
    board: [],
    activeQuests: [],
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
  // Runeguard (Defend the Forge): schedule the Epic Runeforge for turn 12 — advanceCombat's start-of-turn
  // sequencing opens it (behind any quest offer). Cleared once it fires.
  if (hero.power.kind === 'epicRuneforge') state.epicForgeWave = 12;
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
  // Disco Dan's Setlist: turn 1 opens three sequential Discovers — Tier 6 first, then Tier 4, then Tier 2 —
  // each pick locked in hand until you reach that shop tier. queueDiscover opens the first and stacks the
  // rest behind it (drained one at a time as each resolves).
  if (heroId === 'discodan') {
    for (const tier of [6, 4, 2]) {
      queueDiscover(state, { kind: 'minion', tier, exactTier: tier, lockTier: tier });
    }
  }
  return state;
}

/** Serialize for save-and-continue / shareable seeds (handoff C.9). */
export function serialize(state: RunState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): RunState {
  const parsed = JSON.parse(json) as RunState & { pendingSpellDiscovers?: number };
  // Heal-by-construction (review 2026-07-03): merge the save over a freshly-created run for the SAME
  // seed/hero/mode, so every field added since the save was written gets its fresh-run zero value
  // automatically. The old hand-maintained ??=-list drifted — it healed `pool`/`line`/`armor` but missed
  // `history`, `tavernBuyBonus`, `spellCostMod`, `freeRolls`, … so an old save crashed the HUD or
  // NaN-corrupted Gold on first touch. Every field the save DOES carry wins the merge; keys the state
  // no longer declares just linger harmlessly.
  const defaults = createRun(parsed.seed ?? 1, parsed.heroId, parsed.mode);
  const state: RunState & { pendingSpellDiscovers?: number } = { ...defaults, ...parsed };
  // Fields whose heal is deliberately NOT the fresh-run default:
  state.armor = parsed.armor ?? 0; // Armor shipped later — a pre-Armor in-progress run gets none, not the hero's
  state.maxArmor = parsed.maxArmor ?? 0;
  if (!parsed.pool) state.pool = stockPool(state.tribes); // pre-pool saves: stock for the run's own tribes
  // Heal saves from before the generalized Discover queue: fold the old single spell-Discover counter
  // (golden Black Belt Brian) into the new queue as that many spell specs.
  if (parsed.pendingSpellDiscovers && parsed.pendingSpellDiscovers > 0) {
    state.discoverQueue = [
      ...(state.discoverQueue ?? []),
      ...Array.from({ length: parsed.pendingSpellDiscovers }, () => ({ kind: 'spell' as const })),
    ];
  }
  delete state.pendingSpellDiscovers;
  return state;
}
