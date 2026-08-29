import { makeRng } from '@game/core';
import type { CombatOutcome, CombatResult, EffectDef, Keyword, QuestObjectiveEvent, Rng, Tribe } from '@game/core';
import { CARD_INDEX, SETS, activeSet, poolFor, type SetId } from '@game/content';
import { CONFIG, HENCHMEN_ARCHIVED, RIFT_BONUS_ARMOR, activeRift, type RiftId } from './config';
import { DEFAULT_HERO_ID, getHero, powerDiscoverPool } from './heroes';
import { generateQuestOffer, questOfferPlan } from './quests';
import { queueDiscover } from './recruit';
import { rollCiaEnchants, rollShop, stockPool } from './shop';
import { selectThreat, type ThreatId } from './threats';
import type { BoardSnapshot } from './snapshot';

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
 * Pick a run's active tribes (handoff: only 5 tribes appear in a run at once) from `roster` — the PINNED
 * set's tribe list, so a set-2 run draws Kobolds and a set-1 run never can. Neutral glue is always available
 * on top. With exactly 5 playable tribes in set 1 this returns all of them (shuffled); it bounds the pool once
 * more are added. A smaller roster (set 2's single `kobold` today) simply returns those.
 */
export function selectRunTribes(rng: Rng, roster: readonly Tribe[] = PLAYABLE_TRIBES): Tribe[] {
  const pool = [...roster];
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

/** The four run-wide tribe-aura channels the Aura Wash FX can announce (see `RunState.auraFx`).
 *  `demon` = the Imp aura; `mech` = the Magnetic/Attachment aura. */
export type AuraFxTribe = 'beast' | 'demon' | 'mech' | 'undead';

export interface ShopCard {
  uid: string;
  cardId: string;
  /** Rune of the Bargain Bin: this offer sells for 0 once bought (stamped onto the bought minion's `sellOverride`). */
  sellZero?: boolean;
  /** Buffs applied to this offer while it's in the tavern (e.g. the hero power targeting
   *  a shop minion) — baked into the minion's stats/keywords when it's bought. */
  atk?: number;
  hp?: number;
  /** Per-SOURCE breakdown of `atk`/`hp` (Apples, Fortify, Fried Circuits, …) so the tavern inspect + the bought
   *  minion attribute the buff to the right name instead of a generic label. Sums to `atk`/`hp`. */
  buffs?: CardBuff[];
  keywords?: Keyword[];
  /** Golden Touch: this offer buys in as a Golden (offer-level flag; the buy path bakes golden:true in). */
  golden?: boolean;
  /** Pete (Contrabanana): this offer was upgraded to the tier ABOVE the Shop tier on his 3rd refresh — the UI
   *  flashes it once as the row lands so the smuggled unit reads as special. Presentation only. */
  contraband?: boolean;
  /** Croupier Ayse (Lucky Seat): this offer wears the Enchanted treatment — a purple chained wisp swirling
   *  around the card. Purely cosmetic on the card itself (it changes NOTHING about what you buy); its only
   *  mechanical role is that buying it advances `ciaEnchantedBought` toward her prize. */
  enchanted?: boolean;
  /** Moe: a set discount price for this offer (a guaranteed Attachment costs 2 Gold). When present, the buy
   *  path charges this instead of the flat minion cost, and the UI shows a green price coin (a changed price). */
  cost?: number;
  /** Displacement: a board minion stashed here when swapped to the tavern — restored INTACT (all buffs /
   *  stats / progression) when re-bought or swapped back, rather than re-instantiated from base. */
  held?: BoardCard;
  /** Layaway: this offer survives rerolls (it's kept out of the pool return and re-added in place on a roll)
   *  for the CURRENT shop phase — cleared at `faceOmen`, so the first refresh after combat sweeps it (recast
   *  Layaway to keep it again). Any `cost` reduction rides the offer while it lasts. */
  kept?: boolean;
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
  /** Rune of the Bargain Bin: an overridden sell value (0) — read by `sellValueOf` ahead of the normal calc. */
  sellOverride?: number;
  keywords: Keyword[];
  golden: boolean;
  /** Anomaly Reactor: extra tribes granted to THIS instance beyond its printed tribe(s) (a spell-added Mech
   *  type). Honored by `isTribe` (recruit synergies / magnetize / auras) and folded into the combat minion's
   *  `tribe2` at `instantiate`. Absent = none. */
  addedTribes?: Tribe[];
  /** Anomaly Reactor's "All" mode: this instance counts as EVERY tribe for the rest of the run — `isTribe`
   *  short-circuits true, and combat seeds `universalTribe` from it. */
  allTribes?: boolean;
  /** Choose One: the index into the def's `chooseOne` that the player PICKED for this instance. Purely a record
   *  of the decision — the chosen effects resolve once, at pick time — but the card must keep showing only the
   *  branch it became, so the printed text stops listing options it can no longer do (owner 2026-07-24). A
   *  golden `chooseBothWhenGolden` card gains both, so it records none and keeps its combined text. Absent on
   *  every card without a Choose One, and on one that somehow reached the board without resolving. */
  chosenOption?: number;
  /** Triple-reward Discover spell: the shop tier CAPTURED when it was granted to hand, so its "peek one tier up"
   *  is frozen at grant time — taverning up afterwards no longer inflates the Discover's tier (owner 2026-07-15).
   *  Read by the `discoverOnPlay` resolution + the live card text; absent on non-granted cards. */
  grantedTier?: number;
  /** Per-source recruit-phase stat buffs applied to this instance (Karwind, Nadir, Spirit Fire,
   *  Fortify, …) — drives the inspect-panel breakdown. Base stats are NOT recorded here. */
  buffs?: CardBuff[];
  /** Extra magnitude on this card's summon-buff effect, accrued permanently across the run
   *  (Kennelmaster's Avenge improvements). Default/absent = 0. */
  /** Chef Gary Toast: stats handed out this shop turn (Rune of the Chef spends it as a combat Rally in the
   *  fight that follows). Per-instance — two Chefs each keep their own. Reset at the turn rollover. */
  chefGranted?: number;
  summonBonus?: number;
  /** RALLY (shop dispatch) — rallies this body has WITNESSED in the current End-of-Turn pass (Crypt Drake's
   *  "every 2 ally attacks", Rouge Rogue's Imp tally) and Evolving Abomination's per-pass doubling counter.
   *  Both are per-FIGHT counters in combat; `fireRallies` clears them around each shop pass so a shop rally
   *  can never inherit last turn's progress. */
  attackSeen?: number;
  bredCount?: number;
  /** RALLY — Sunmane Herald's accrued rally Attack on this body (what it passes on when it rallies). Genuinely
   *  per-instance and run-long, so unlike the two above it is NOT cleared between passes. */
  rallySpreadAtk?: number;
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
  /** Effects GRAFTED onto this body at runtime (Sunmane Herald's spreading Rally). Combat has a per-instance
   *  `Minion.effects` list to push onto; a BoardCard has only its printed def, so grafts live here and every
   *  recruit dispatcher reads them alongside the def via `instanceEffects`. */
  grantedEffects?: EffectDef[];
  /** ASHEN HEIR (shop half, owner ruling 2026-08-26): Imp stats banked when an Imp died with no living Imp to
   *  receive them — paid out to the next Imp summoned. Mirrors the combat instance field. */
  impBank?: { attack: number; health: number };
  /** BROOD MATRON (shop half, owner ruling 2026-08-26): friend-death summons this turn, against the card's
   *  `max` cap — reset at the turn rollover, mirroring the per-fight combat counter. */
  bredThisTurn?: number;
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
  /** Parting Cry (spell): when this minion dies next combat, its Shout fires. Cleared at settle (one combat). */
  partingCry?: boolean;
  /** Closed Casket (spell): this minion is DESTROYED at Start of Combat next combat — a real death, so its
   *  Echo and every other death watcher fire naturally. Cleared at settle (one combat). */
  closedCasket?: boolean;
  /** Disco Dan: a hand card that cannot be PLAYED until you reach this shop tier (the T6/T4/T2 minions his
   *  Setlist Discovers on turn 1). Only THIS card is gated — the rest of the hand plays normally. The play
   *  action no-ops while `state.tier < lockedUntilTier`; the UI shows it locked. Cleared once it unlocks. */
  lockedUntilTier?: number;
  /** Brackus's Summit pick: unplayable until the run's cumulative `goldSpent` reaches this. The `play`
   *  action no-ops below it and the UI shows it locked — the same contract as `lockedUntilTier`, on a
   *  different meter. Reuses the existing run-cumulative `goldSpent` (no new counter needed). */
  lockedUntilGoldSpent?: number;
  /** Hourglass Reserve: a hand card that cannot be played until you reach this WAVE (the wave AFTER it was
   *  discovered) — the "can't play until next turn" lock. Same contract as `lockedUntilTier`, on the wave meter. */
  lockedUntilWave?: number;
  /** Funeral on Loan: a BORROWED minion. Playing it triggers its Echo (Deathrattle) out of combat and destroys
   *  it (never enters the board). It is NOT discarded at turn end — it keeps in hand until played. */
  borrowed?: boolean;
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
  /** Runic Archivist: minions sold while this card is on the board, counted toward its every-N payout. Carries
   *  round to round (owner 2026-07-27: "progress carries round to round") and keeps the remainder past each
   *  payout, so a partial tally is never thrown away. Per-instance; absent = 0. */
  soldProgress?: number;
  /** Ex-Galloper's no-chain guard: a copy summoned "without the Echo". A BoardCard has no per-instance
   *  effects list to strip, so the shop marks the copy and the Echo dispatch skips marked bodies. */
  echoStripped?: boolean;
  /** Gold-spend meter for `goldSpent` effects (Acid, Banksly): accrues the Gold spent while this card is on
   *  the board, firing its payoff each time it crosses the threshold. Continuous across turns (carries the
   *  remainder), per-instance; absent = 0. */
  goldTick?: number;
  /** Cards-bought meter for `cardsBought` effects (Korok, Banksly): counts the cards bought while this card is
   *  on the board, firing its payoff each time it crosses the threshold. Continuous across turns (carries the
   *  remainder), per-instance; absent = 0. The buy-count sibling of `goldTick`. */
  buyTick?: number;
  /** Set 2 — cumulative cards-PLAYED tally for this instance (Mountainbond), the twin of `buyTick`. */
  playTick?: number;
  /** Set 2 — Ruby Broker: Rubies played on THIS minion this turn (its per-turn Gold cap). Reset each wave. */
  rubyRecvTick?: number;
  /** End-of-Turn tick counter for cadence effects (Frontdrake: every 3 turns, get a Dragon). Advances
   *  once per turn this card is on the board (not per Chronos repeat). Per-instance; absent = 0. */
  eotTick?: number;
  /** Set 2 — spells cast ON this minion THIS TURN (Mirrorwing Hatchling / Runefire). Reset each turn with the
   *  other per-turn counters. Incremented BEFORE a card's `spellCastOnThis` effects run, which is what stops a
   *  re-cast from re-triggering the same effect forever. Absent = 0. */
  spellsOnThisTurn?: number;
  /** Set 2 — RUBIES played on this minion this turn. Kept separate from `spellsOnThisTurn` on purpose: Runefire
   *  works with Rubies as well as Shop spells and reads the SUM, while Mirrorwing Hatchling is Shop-spell-only
   *  (owner 2026-07-24) and must stay blind to Rubies. One shared counter would let a Ruby silently eat
   *  Mirrorwing's once-per-turn slot without triggering it — worse than either behaviour. Absent = 0. */
  rubiesOnThisTurn?: number;
  /** Set 2 — Spellkeeper Drake: SHOP SPELLS cast this turn WHILE this minion has been on board, and the id of
   *  the first such spell. Per-instance (a Spellkeeper played mid-turn counts from its own placement, not turn
   *  start — owner 2026-07-24). Reset each turn; a fresh card starts at 0/undefined, so placement is the floor. */
  /** Next-combat spell grants on this minion (Last Stand's Rise, …) — display-only in the shop: the label
   *  prints gold-parenthesized in the card text + buff list, and the keyword badge previews. `faceOmen`
   *  stamps the REAL grant from `pendingCombatKeywords` and clears these. */
  tempGrants?: { label: string; keyword: string }[];
  boardSpellCount?: number;
  /** Voicekeeper: matching sales THIS body has witnessed this turn (per-instance, so a copy played mid-turn
   *  counts from its own placement, not from turn start). Reset each `faceOmen`. */
  soldSeen?: number;
  /** Moonhowl Mentor: taught Pups THIS body has produced this turn (per-instance — every copy owns its own
   *  "once per turn", golden = twice). Reset each `faceOmen`. */
  teachTick?: number;
  /** Gemgorge Fiend: spell+Ruby casts THIS body has witnessed since it hit the board (per-instance, so a
   *  freshly bought copy starts at 0/3 rather than inheriting the run's lifetime total). Run-long — the
   *  meter is "every 3 casts", not a per-turn window. */
  rubyCastTick?: number;
  boardFirstSpellId?: string;
  /** Set 2 — Moonhowl Mentor's Mage-Pup: the SHOP SPELL this token was taught. Its Shout casts that spell, so
   *  the token's effect is per-instance rather than baked into the CardDef. */
  taughtSpellId?: string;
  /** Set 2 — Scalechanter: Shouts triggered since its LAST improvement (a per-instance cadence counter, the
   *  Shout twin of `eotTick`). Rolls back to 0 each time it improves, so the "every 3" is a cadence rather
   *  than a running total. Absent = 0. */
  shoutTick?: number;
  /** CELESTIAL "Orbit (N)": this instance's orbit counter. An Orbit effect carrying an `every` param fires
   *  only on each Nth trigger — the same per-instance cadence shape as `shoutTick` / `buyTick`, so it
   *  carries across combat exactly as those do. */
  orbitTick?: number;
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
/**
 * How a run was started, chosen on the mode screen behind PLAY.
 *  - `ascent`   the scored climb, UNMODIFIED (no rift)
 *  - `rift`     the same climb WITH the currently active rift's rules (opt-in as of the mode picker)
 *  - `practice` the same course, any hero, unlimited Resolve, longer shop timer — unscored
 * Pinned onto the run at creation; `createRun` reads it to decide whether to adopt `activeRift()`.
 */
/** `lobby` is a seat in an 8-seat elimination lobby: it plays the ordinary game but has no course clock, because
 *  a lobby ends by elimination rather than after a fixed 17 rounds. Its Resolve is bookkeeping only — the LOBBY
 *  owns the seat's real health — so it never terminates on its own. Everything else behaves exactly like Ascent.
 *
 *  `tutorial` is a SCRIPTED lobby for the first-time-player course (Learn Ascent): same 8-seat structure, but
 *  the opponents are authored effectless `omen` boards and the shop is scripted. It is DELIBERATELY a distinct
 *  mode, not `lobby` — the run-end flow rates and uploads only when `mode === 'lobby'`, so a tutorial must not
 *  wear that mode or it would move the player's ladder rating and upload telemetry/boards. Being its own mode,
 *  it is excluded from every one of those gates for free. */
export type RunMode = 'ascent' | 'rift' | 'practice' | 'lobby' | 'tutorial';

/** The tribes a Practice "tribe surge" can favour (a 100% draw-weight boost for that tribe's shop cards). */
export type SurgeTribe = 'beast' | 'dragon' | 'kobold' | 'demon' | 'dwarf';

/** The Practice setup screen's choices (owner ask 2026-08-24). Pinned onto a practice run at creation. */
export interface PracticeConfig {
  /** Who fills the other seven seats: recorded real player warbands, or effectless scaling bots. */
  opponents: 'players' | 'bots';
  /** Bot strength when `opponents === 'bots'` — scales the authored per-round board table. */
  botDifficulty: 'easy' | 'medium' | 'hard';
  /** `unlimited` = the classic Practice invulnerability + round-15 curtain; `normal` = real elimination. */
  health: 'unlimited' | 'normal';
  /** Shop-timer multiplier (1–4×), the same knob the in-run Practice timer dropdown drives. */
  timeMult: 1 | 2 | 3 | 4;
  /** A tribe whose shop cards are twice as likely to appear, or null for the ordinary flat draw. */
  tribeSurge: SurgeTribe | null;
}

/** The default Practice options — the classic Practice experience, so an untouched setup screen plays exactly
 *  as Practice always has (recorded opponents, invulnerable, 1× timer, no surge). */
export const DEFAULT_PRACTICE_CONFIG: PracticeConfig = {
  opponents: 'players', botDifficulty: 'medium', health: 'unlimited', timeMult: 1, tribeSurge: null,
};

export type DiscoverSpec =
  | { kind: 'spell' }
  | { kind: 'minion'; tier: number; exactTier?: number; filter?: 'battlecry' | 'deathrattle'; tribe?: Tribe; tribes?: Tribe[]; exclude?: string; topTierFirst?: boolean; lockTier?: number; lockGold?: number; golden?: boolean; maxTier?: number; lockWave?: number; borrowed?: boolean; setStats?: { attack: number; health: number } }
  // A Discover from an EXPLICIT card-id pool (Rune of the Second Path's Greater-Quest reward minions; Rival's Reflection).
  | { kind: 'pool'; ids: string[]; borrowed?: boolean };

/** A quest the player has bought — its live objective progress + completion flag. Persists for the run
 *  (shown in the quest panel); one is bought per quest turn, so most heroes accumulate up to 2 (waves 5 & 11),
 *  or up to 3 with Fi's bonus Lesser-only turn-3 offer. */
export interface ActiveQuest {
  questId: string;
  progress: number;
  completed: boolean;
  /** How many times this quest has fired its reward. A one-shot quest sets `completed` and this is 1; a REPEATABLE
   *  quest (Forest Grove, Scrap Contract, Imp Census, Dark Bargain, …) never sets `completed` but bumps this on
   *  each re-fire — so telemetry/trophies can still see it was completed (and count how often). Absent = 0. */
  completionCount?: number;
  /** The Author's Hand compound objective: per-key progress toward the shared `count` (Shout / Echo / Rally each).
   *  `progress` mirrors the min of the three for the panel bar. Absent for normal single-count objectives. */
  subProgress?: { shout: number; echo: number; rally: number };
  /** A general compound objective (`event: 'compound'`): per-part progress, index-aligned with `objective.parts`.
   *  Each part has its own count; the quest completes when all parts fill. `progress` = Σ part progress (bar). */
  partProgress?: number[];
}

/** One shop-phase buff-other, captured for the UI to replay as a source→target tendril (living-minion source)
 *  or a rain-down descend (`spell` / `deathrattle` — no living source). Pure display metadata: consumes no RNG
 *  and does not affect stats, so determinism / golden sims are unaffected. Mirrors the `fodderEaten` pattern. */
export interface BuffFxEvent {
  sourceUid?: string;       // present + kind:'minion' → tendril from this board minion; absent → descend
  targetUid: string;
  attack: number;
  health: number;
  sourceCardId: string;     // for buffPreset (tendril tribe look)
  sourceTribe: Tribe;
  kind: 'minion' | 'spell' | 'deathrattle';
  /** Itemized per-z rewards (Blueprint Cache's "+2/+2 per Attachment") group their events into WAVES — one
   *  wave per unit of the scaler, each wave hitting EVERY eligible minion at once. The UI staggers between
   *  waves (never within one), so all the Mechs pulse together and the steps read one at a time. Absent for
   *  ordinary one-shot buffs. */
  fxWave?: number;
}

/** One card a Ruby landed on this action, and HOW MANY landed on it. The count is the information: a gilded
 *  Frenzied Excavator plays two per minion, and collapsing that to a uid list (which this was) made the board
 *  under-report a doubled effect as a single one. The UI renders it as a CASCADE of N-STACKS — see
 *  docs/fx-vocabulary.md. */
/** One shop cue: a body that died, or an Echo that triggered. `uid` is the minion it happened to — already
 *  gone from the board for a death, which is why the UI keeps a last-known-position cache. */
/** One equip cue: a body granting its Equipment, on play or at the Start-of-Turn rebuild. */
export interface EquipFx {
  /**
   * `equip`   — a fresh grant (the full animation),
   * `reequip` — the turn-start refresh (one per EQUIPMENT, not per source — owner ruling 2026-08-28),
   * `use`     — an activation: the Equipment's own effect, travelling from the slot to what it was cast on.
   */
  kind: 'equip' | 'reequip' | 'use';
  uid: string;
  cardId: string;
  /** `use` only: the Equipment that fired, so the UI can look up its authored FX and SFX. */
  equipmentId?: string;
  /** `use` only: what it was cast on — the travel destination. Absent for an untargeted Equipment. */
  targetUid?: string;
}

export interface ShopDeathFx {
  kind: 'death' | 'echo';
  uid: string;
  cardId: string;
  /** Death only: the body is rising, so it must NOT dissolve (it re-forms). */
  rise?: boolean;
}

export interface RubyLandedFx { uid: string; count: number; }

/** Which tavern offers VEINSTORM gemmed this action, and whether it was the cast or a refresh re-stamp.
 *  Distinct from `rubyLandedFx` on purpose: Veinstorm gems the whole shop as ONE event (a spanning volley, a
 *  single sound), where a lone Ruby dragged onto an offer is a per-card gem — and only Veinstorm's chokepoint
 *  (`stampVeinstormRubies`) can tell them apart, since both land the SAME 'Ruby' buff. `onRefresh` lets the UI
 *  hold the span a beat on a re-stamp so it lands with the offers rather than before they finish sliding in.
 *
 *  `attack`/`health` is the per-offer Ruby value this action added — UNIFORM across every gemmed offer (the
 *  cast stamps `1 + rubyBonus` to each, a refresh stamps the banked grant to each). Carried so the badge can
 *  withhold EXACTLY what just landed, rather than recovering it from the offer's Ruby-buff total ÷ count —
 *  which is only the average, and so is off on an offer that already carried a Ruby before Veinstorm hit it. */
export interface VeinstormFx { uids: string[]; onRefresh: boolean; attack: number; health: number; }

/** A RUN-WIDE shop buff — "minions in the Shop get +A/+H" landing on every offer at once (Staff of Guel,
 *  Contract Butcher, Soul Defiler, a quest's `shopBuff` reward). `uids` are the offers on screen when it
 *  landed, so a cue can span the row; the aura itself is camera-anchored and does not need them.
 *
 *  Deliberately measured off `tavernBuyBonus`, the run-wide channel, which is what makes this mean ALL shop
 *  units rather than one: Market Tormentor's single-offer Shout rides the per-offer channel and is invisible
 *  here, and Veinstorm's shop gemming was explicitly moved OFF this channel (see `spellBuffShopByRuby`) so
 *  Ruby readers could see its stats — which keeps the gem effects out of this signal for free. */
export interface ShopBuffAllFx { uids: string[]; attack: number; health: number; }

/** Croupier Ayse's five rewards. Ordered as the classic suit ranking with the Ace last (owner addition
 *  2026-08-22); the order is not load-bearing (the pick is random) but keeps the reward table, the art slugs
 *  and the UI reading the same way. */
export type CiaSuit = 'hearts' | 'spades' | 'diamonds' | 'clubs' | 'ace';

/** Cassen's three commissions. The delay is part of the identity — a longer wait buys a bigger payout. */
export type CommissionKind = 'discover' | 'gold' | 'spell' | 'citadel' | 'fortress';
/** An ACTIVE commission: what was picked and the wave it matures on. Only ever one at a time. */
export interface Commission { kind: CommissionKind; dueWave: number; }

/**
 * Mark a RUNE as having fired, for its badge's burst + bounce (`runeTriggerFx.ts`).
 *
 * Named by REWARD KIND rather than by rune id because that is what a trigger site actually knows: it has just
 * read a boolean like `s.runeBrew`, which does not remember which rune set it. `runeIdByKind`, recorded at
 * purchase, closes that gap — so a site is one line and cannot name a rune the player does not own.
 *
 * A no-op when the kind was never installed, so calling it unconditionally at a trigger site is safe.
 * Display only: nothing in the sim branches on `runeProcs`.
 */
export function procRune(s: RunState, kind: string, times = 1): void {
  const id = s.runeIdByKind?.[kind];
  if (!id) return;
  procRuneId(s, id, times);
}

/**
 * The same mark, by rune ID directly — for sites that already know which rune they are.
 *
 * `runeThreshold` is why this exists and is not a nicety: EIGHT different runes share that one reward kind
 * (Chorus, Overtime, Infernal Ink, Cindergem, Showcase, Merchant's Chorus, Empty Plate, Gem Dividend), and a
 * player can own several at once. `runeIdByKind` holds one id per kind, so routing them through `procRune`
 * would credit every threshold payout to whichever of them was bought LAST. They are stored as a list, each
 * entry carrying its own `sourceId`, so the id is right there — one stamp at the payout chokepoint covers all
 * eight, correctly attributed.
 */
/** Is this buff `source` label a RUNE's? Rune buffs almost all label themselves `'Rune …'`; the handful that
 *  use a flavor label are listed explicitly. Used to drive the `rune-buff-unit` FX on any minion a rune buffs
 *  (owner ask 2026-08-19). Cheap string test — buffs carry their source label on `card.buffs`. */
export function isRuneBuffSource(source: string): boolean {
  return source.startsWith('Rune') || source === 'Twin Sun Oath';
}

/** Total rune-sourced buff magnitude (Σ attack+health) on a card — the diff of this across an action is what
 *  tells the UI a rune just buffed the minion. */
export function runeBuffMagnitude(card: { buffs?: { source: string; attack: number; health: number }[] }): number {
  let m = 0;
  for (const b of card.buffs ?? []) if (isRuneBuffSource(b.source)) m += b.attack + b.health;
  return m;
}

/** Coerce a once-per-turn latch that GREW into a use counter (rune duplicate stacking, 2026-08-27) — older
 *  saves hold `true` for "used once"; new writes hold the count. */
export function gateUses(v: number | boolean | undefined): number {
  return typeof v === 'number' ? v : v ? 1 : 0;
}

export function procRuneId(s: RunState, id: string | undefined, times = 1): void {
  // `id` is optional because a threshold entry restored from an older save may predate `sourceId`; an
  // unattributable proc is simply not stamped rather than crashing the shop.
  if (!id || times <= 0) return;
  s.runeProcs = { ...(s.runeProcs ?? {}) };
  s.runeProcs[id] = (s.runeProcs[id] ?? 0) + times;
}

export interface RunState {
  seed: number;
  /** Game mode — see `RunMode`.
   *  'ascent' (the scored climb) or 'practice' (the SAME course — any hero, unlimited health,
   *  3× shop timer — so it reads identically to Ascent; ends at `courseRounds` regardless of W/L, unscored).
   *  Absent = 'ascent'. */
  mode?: RunMode;
  /** Scene Builder sandbox (dev). Runs on the `practice` mode mechanics (unscored, generous timer) but is
   *  launched as its own thing from the title, and mounts the Scene Builder control panel. Additive flag so
   *  it needs no new RunMode + no mode-switch audit. Absent = a normal run. */
  sandbox?: boolean;
  /** Practice options (owner ask 2026-08-24): the knobs chosen on the Practice setup screen, pinned onto the
   *  run at creation. Absent on every non-practice run (and on a default-options practice run). Read by the
   *  lobby (bot vs recorded opponents), the reducer (health → invulnerability + curtain), and the shop (tribe
   *  surge). Plain data, so it serializes with the run. See `PracticeConfig`. */
  practiceConfig?: PracticeConfig;
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
  /** Set 2 — Mushy: a charge to copy the FIRST spell you cast on/after `activateWave` (= the wave
   *  AFTER the Echo fired, so "next turn" is exact whether it died in combat or was re-fired in recruit).
   *  `count` copies (golden 2, multiple Scalefeathers sum). Spent + cleared by that first cast. */
  nextTurnSpellCopies?: { activateWave: number; count: number };
  /** Quick Sale: extra Gold added to the NEXT minion sold this turn (added on top of its sell value, then
   *  cleared). Also cleared at turn end if unused ("this turn"). Stacks if cast twice. Absent = 0. */
  nextSellBonus?: number;
  /** Marked Target: the enemy's RIGHT-MOST minion enters the next combat with Taunt (applied to the enemy
   *  board in `faceOmen`, then cleared). One fight only. Absent = off. */
  markEnemyRightmostTaunt?: boolean;
  /** Open the Gates: Imps banked to enter the NEXT combat on the player's board (added in `faceOmen`, up to the
   *  7-slot cap, then spent). Absent = 0. */
  pendingSCImps?: number;
  /** Farseer's Report: 3 scouted minions from the NEXT opponent's warband, shown in a read-only Discover-style
   *  reveal. Set on cast, cleared on close / at turn start. Stats are the opponent's actual (final, doubled-for-
   *  golden) values; `golden` marks a triple; `buffs` is the opponent's per-source buff breakdown (captured in
   *  the snapshot) so right-click inspect reveals HOW they buffed it. */
  scoutedNextOpponent?: { cardId: string; attack: number; health: number; golden?: boolean; buffs?: CardBuff[] }[];
  /** Pre-emptive Assault: the player's board attacks first in the NEXT combat, overriding the
   *  more-minions initiative rule (ties included). One-shot — cleared in `settleCombat`. */
  attackFirstNext?: boolean;
  /** Rallying Offensive: your Rally effects trigger twice in the NEXT combat. One-shot — does not stack
   *  (a bool), cleared in `settleCombat`. */
  rallyDoubleNext?: boolean;
  /** Nimbus: EXTRA casts banked for the NEXT Tavern spell — +1 per Battlecry fire (+2 if Nimbus was golden).
   *  ADDITIVE, not a multiplier (owner 2026-07-24), which is what lets it ACCUMULATE: Drakko fires the
   *  Battlecry twice, so two Nimbus fires bank +2. The old `nextSpellMult` SET a multiplier, so a second fire
   *  just re-set the same value and Drakko did nothing for it.
   *  Read by `spellCasts` (added to the multiplied total), spent by the reducer on the next real
   *  (non-singleCast) spell cast; persists across turns until used (NOT cleared at settle). */
  nextSpellExtraCasts?: number;
  /** Gold spent during the CURRENT recruit turn (buys, rerolls, tier-ups, hero powers) — Patch Job scales off
   *  it (+3/+3 per 7 Gold). Accrued in `spendGold`, reset to 0 each turn in the wave-advance. Distinct from
   *  the lifetime `goldSpent` career stat. */
  goldSpentThisTurn?: number;
  /** Set 2 — Ales CAST this turn (Chef Gary Toast scales off it). Reset with the other per-turn tallies. */
  alesCastThisTurn?: number;
  /** Set 2 — cards PLAYED this run, cumulative. Mountainbond's "after you play 8 cards" is a running total, not
   *  a per-turn one, so it can't ride `playedThisTurn` (which clears every turn). */
  cardsPlayedTotal?: number;
  /** Set 2 — cards bought THIS turn (reset each wave). Threaded into combat for Frenzied Excavator's
   *  Start-of-Combat "play 1 Ruby per 4 cards bought this turn" scaler. Absent = 0. */
  cardsBoughtThisTurn?: number;
  /** Minion cardIds PLAYED this recruit turn (normal plays) — Pack Leader (SoC, via a simulate param) and
   *  Spirit Worgen (End of Turn) scale off "Beasts/Dragons you played this turn". Reset each turn. */
  playedThisTurn?: string[];
  /** Set 2 — card ids SOLD this turn, in sell order (the symmetric twin of `playedThisTurn`). Voicekeeper
   *  reads it to tell "the FIRST Dragon you sell each turn" from later ones. Appended BEFORE the `minionSold`
   *  notify, so a watcher sees the sale it's reacting to already recorded. Reset each turn. */
  soldThisTurn?: string[];
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
  /** Set 2 — the run's Ruby STRENGTH: the extra Attack/Health every NEW Ruby is minted with, on top of the
   *  base 1/1 (raised by "Your Rubies gain +X"; future Rubies only, never retroactive). Absent = base 1/1. */
  rubyBonus?: { attack: number; health: number };
  /** Rubies cast this run / this turn — the Ruby-only cast counter (NOT `spellsCast`, which is Shop Spells).
   *  Cards that trigger on the umbrella of BOTH read `spellsCast + rubyCasts`. Absent = 0. */
  rubyCasts?: number;
  /** Ruby PLAYS from hand this turn (one per play, however many times it multicasts) — the gate for the
   *  first-N-each-turn extra cast. Reset at turn start (it wasn't until 2026-08-06, which made every
   *  "first Ruby each turn" rune a first-Ruby-each-RUN rune — owner report on Resonance). */
  rubyCastsThisTurn?: number;
  /** How many leading Ruby plays each turn get `rubyFirstExtraCasts` (default 1; Resonance sets 2). */
  rubyFirstCastWindow?: number;
  /** Set 2 quests — run-level EXTRA Ruby casts, additive with Prismcaster's per-minion `rubyExtraCast`.
   *  `rubyExtraCasts` applies to every Ruby (Unstable Riches); `rubyFirstExtraCasts` only to the turn's first
   *  (Gem Circuit), gated on `rubyCastsThisTurn === 0` so reading the count stays side-effect free — the real
   *  cast path spends the freebie by bumping that counter, exactly like Spell Thesis. */
  rubyExtraCasts?: number;
  rubyFirstExtraCasts?: number;
  /** Bane's Presence: every `per` Shouts triggered, buff the shop +attack/+health. `tick` banks the remainder
   *  across turns, so three Shouts spread over two turns still pay exactly once. */
  shopBuffPerShouts?: { per: number; attack: number; health: number; tick: number };
  /** The Endless Verse: every `per` Shouts triggered, clear `spellFirstUsedThisTurn` so the turn's spell
   *  doubler re-arms. `tick` banks the remainder across turns like the other threshold rewards. */
  endlessVerse?: { per: number; tick: number };
  /** Motherlode: on every Ruby gained, cast a copy on `count` random friendly `tribe` minions. */
  /** Armed threshold runes (Cindergem, Infernal Ink, Overtime, the Chorus, the Long Shift, the Showcase, the
   *  Merchant's Chorus). An ARRAY, so several can be held at once and each keeps its own banked remainder.
   *  `usedThisTurn` backs `oncePerTurn`; it resets with the other per-turn tallies. */
  runeThresholds?: {
    /** The rune/quest id that armed this meter. Carried so the HUD can put a live `tick/per` tally on that
     *  specific badge — several threshold runes can be held at once, so a flat list alone can't say which
     *  belongs to which (owner ask 2026-08-03: "runes/quests should all have tally trackers"). */
    sourceId?: string;
    meter: 'gold' | 'spellCast' | 'spellCastNonAle' | 'castRuby' | 'cardsBought' | 'cardsPlayed' | 'playDragon' | 'shout' | 'consume'; per: number; tick: number;
    grantGoldNextTurn?: number; resetEachTurn?: boolean;
    grantSpell?: number; grantAle?: number; grantRuby?: number;
    /** Rune of the Deep Feast: exact card ids handed over when the meter trips. */
    grantCards?: string[];
    /** Rune of the Gilded Ledger: cast that many random stat-granting Shop spells when the meter trips. */
    castStatSpell?: number;
    /** Rune of Gemspam: play a Ruby on EVERY friendly minion when the meter trips. */
    rubyAll?: boolean;
    /** `step` (Compounding Wages) ESCALATES the payout: the grant grows by `step` after every payout, so the
     *  buff written here is mutated in place and the badge prints the CURRENT size. */
    buff?: { target: 'imps' | 'shop' | 'shopRightmost' | 'shopTurn' | 'spells' | 'tribe'; tribe?: Tribe; attack: number; health: number; step?: { attack: number; health: number } };
    oncePerTurn?: boolean; usedThisTurn?: boolean;
    /** Bubble Crown: a ONE-SHOT threshold — `once` declares it, `spent` records that it has paid. */
    once?: boolean; spent?: boolean;
  }[];
  /** Rune of the Brokerage: Ruby Brokers ignore their per-turn cap. */
  runeBrokerage?: boolean;
  /** Rune of the Shared Table: each Ale cast buffs one friendly minion of every type. */
  runeSharedTable?: { attack: number; health: number };
  /** Rune of Redirection: a Ruby on your left-most also casts on your right-most. */
  runeRedirection?: boolean;
  /** Rune of Distillation: a spell cast on a SHOP minion also casts on your left-most board minion. */
  runeDistillation?: boolean;
  /** Rune of Liquidation: selling a minion hands its BONUS stats (everything above its printed base) to the
   *  right-most Shop minion. */
  runeLiquidation?: boolean;
  /** Rune of Facetwright: a Facetwright's Choice cast resolves BOTH branches, not the picked one. */
  runeFacetwright?: boolean;
  /** Rune of Duplication: the next Epic rune bought also applies its reward a second time. */
  runeDuplication?: boolean;
  /** Rune of Profit Sharing: whenever you GAIN Gold, buff this tribe wherever it is. */
  runeProfitSharing?: { tribe: Tribe; attack: number; health: number };
  /** Rune of the White Wolf: buying a Shop spell teaches it to a Mage-Pup (shares the Mentor per-turn cap). */
  /** Rune of the White Wolf — how many COPIES are held, each adding one Mage-Pup teach per turn (a count,
   *  not a flag, so Rune of Duplication genuinely grants a second pup — owner ruling 2026-08-06: "white wolf
   *  should give a second pup as if you had 2 mentors"). Legacy saves stored `true`; read defensively. */
  runeWhiteWolf?: boolean | number;
  /** Rune of the Spellstone: a Ruby you cast also counts as a Shop-spell cast. */
  runeSpellstone?: boolean;
  /** Rune of Investment: Rubies minted per minion sold. */
  runeSellRubies?: number;
  runeSellRubiesSold?: number; // Rune of Investment: sells counted toward the every-2 payout
  /** Rune of the Open Market: the first Shop-minion Consume each turn buffs the Shop. `used` resets per turn. */
  runeOpenMarket?: { attack: number; health: number; usedThisTurn?: boolean };
  motherlode?: { count: number; tribe?: Tribe };
  /** Bottomless Banquet: the first Shop-minion Consume each turn eats a second. Reset with the per-turn tallies. */
  consumeDoubleFirstEachTurn?: boolean;
  consumeDoubleUsedThisTurn?: boolean;
  /** Lifetime count of SHOP minions your Demons have Consumed — the `consumeShopMinion` objective's meter.
   *  Separate from the Fodder tally: the two consume mechanics must not fill each other's quests. */
  shopMinionsEaten?: number;
  /** Market Tormentor: the accumulated right-most-SLOT buff. Run-level on purpose — the owner's spec is that
   *  the buff outlives the Tormentor (a Shout, not an aura), stacks across plays, and re-lands on the
   *  right-most minion of every fresh roll. Applied incrementally to the CURRENT shop at Shout time and in
   *  full to each new roll (`applyShopRefreshed`). */
  rightmostSlotBuff?: { attack: number; health: number };
  /** Rune of Beastial Swarm: the current per-Beast-death buff amount (starts 2; Avenge(2) raises it +2 each,
   *  carried across combats). Undefined until the rune is held; the combat builder defaults it to 2. */
  beastialSwarmLevel?: number;
  /** Rune of the Display Case: the accumulated LEFT-most-slot enchant (Market Tormentor's mirror of
   *  `rightmostSlotBuff`), re-landed on the left offer each roll by `applyShopRefreshed`. */
  leftmostSlotBuff?: { attack: number; health: number };
  /** Endless Inventory: after each shop refresh, buff the shop — and improve the magnitude by `step` every
   *  `per` refreshes. `grown` is the accrued improvement, `tick` the progress toward the next step. */
  shopBuffOnRefresh?: { attack: number; health: number; step: number; per: number; grown: number; tick: number };
  /** Rune of the Wheel (`shopAuraGrowing`): the standing shop aura's growth meter. The BASE +A/+H landed in
   *  `tavernBuyBonus` when the rune was bought; each refresh ticks this, and every `per`-th adds +step/+step
   *  more to the same channel. `grown` is display-only (the live "+X/+X now" on the badge). */
  shopAuraGrow?: { step: number; per: number; tick: number; grown: number };
  /** Chrono Staff: this turn's End-of-Turn effects fire one extra time (a per-turn flag — stacks with
   *  Chronos, not with itself). Set on cast, reset at the next turn start. Absent = false. */
  extraEotThisTurn?: boolean;
  /** Steward of Spells: the id of the most recent spell cast this run (persists across turns until the next
   *  cast). Absent until a spell is cast. */
  lastSpellCastId?: string;
  /** Runesnout Archivist's journal — the first Shop spell cast on each turn an Archivist was on the board,
   *  in order. Its Echo casts every one of them. Run-lifetime; `rememberedThisTurn` is the per-turn latch. */
  rememberedSpellIds?: string[];
  /** Runesnout Archivist: whether this turn's entry is already recorded (cleared each `faceOmen`). */
  rememberedThisTurn?: boolean;
  /** The last Shop spell cast THIS TURN (reset each wave) — Recaller's copy target. Distinct from
   *  `lastSpellCastId`, which is run-lifetime (Steward of Spells): Recaller's printed rule says "this turn",
   *  and reading the run-lifetime field made it copy LAST turn's spell on a turn where none was cast. */
  lastSpellThisTurnId?: string;
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
  /** Front to Back's lifetime cast count — the escalation improves only every OTHER cast (owner 2026-07-13), so
   *  this parity gates the improvement step. Absent = 0. */
  frontToBackCasts?: number;
  /** Fleeting Vigor — a one-shot Start-of-Combat buff banked for the NEXT combat only (your minions enter
   *  that fight at +this; spent in `faceOmen`, win or lose). Absent = none. */
  fleetingVigor?: { attack: number; health: number };
  /** Banked "for the next combat only" keyword grants (Field Maneuvers → Ward/Flurry, Last Stand → Rise,
   *  Executioner's Edge → Critical Strike). Each names a board minion by uid; `faceOmen` stamps the keyword
   *  (and `critChance` for CR) onto that minion's COMBAT instance, then clears the list — so it's gone after
   *  the fight, exactly like `fleetingVigor`. A grant whose minion is gone by combat simply no-ops. */
  pendingCombatKeywords?: { uid: string; keyword: Keyword; critChance?: number }[];
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
  /** Conductor's run-wide WEIGHTED trigger count: each Conductor Shout adds 1 (×2 gilded, ×2 Mastery). The
   *  Shout grants adjacent minions +(2×this)/+(3×this) — the Squirl Scout snowball, positional. Absent-safe. */
  conductorBuff?: number;
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
  /** Veinstorm (Set 2) — the run-wide shop grant that is made of RUBIES, not of generic tavern stats. Same
   *  shape and lifetime as `tavernBuyBonus` (permanent, folded into every present and future offer by
   *  `offerBuyStats`), but the buy path bakes it in under the `Ruby` source so everything that reads "the
   *  Rubies on this minion" — Gemheart Carver's Golem above all — actually sees it (owner 2026-08-06).
   *  Kept as its OWN accumulator rather than reusing `tavernBuyBonus` so a Staff of Guel buff never
   *  masquerades as a Ruby (and vice versa). */
  /** Rune of the Wild Hunt's accrued escalation — PERMANENT across combats (owner fix 2026-08-01). Seeds each
   *  fight's counter and is written back from `playerWildHuntGrown` at settle. Absent until the rune fires. */
  runeWildHuntGrown?: number;
  /** Apples (Choose One) — a one-shot buff folded into the offers of the NEXT tavern roll (refresh or turn
   *  advance), then cleared. Stacks if cast more than once before the next roll. */
  nextShopBuff?: { attack: number; health: number };
  /** TRANSIENT combat-replay preview of Front-to-Back escalation earned mid-fight (owner ask 2026-08-07: the
   *  held card's printed value moves AS the cast happens, not at settle). The replay accumulates it via
   *  `combatEscalationPreview`; settle clears it — the REAL gain arrives through `playerSpellEscalationGain`,
   *  so this is display-only and can never double-count. */
  fxEscalationPreview?: { attack: number; health: number };
  /** TRANSIENT combat-replay preview of spells cast this fight — Yirin's Attunement counter (and any other
   *  spells-cast reader) ticks live instead of jumping at settle. Cleared at settle, where the REAL count
   *  arrives via `playerSpellsCast`; display-only, so it can never double-count. */
  fxSpellsCastPreview?: number;
  /** TRANSIENT combat-replay preview of Gorun's Blade Mastery ATTACKS this fight — his +N Attack grant and its
   *  "improves every 8 attacks" countdown climb live as his minions swing, instead of jumping at settle. Ticked
   *  by the replay off the `bladeMastery` questTrigger (one per buffed attack); cleared at settle where the real
   *  `bladeAttacks` total lands. Display-only, so it can never double-count. Aevor's kill counter needs no
   *  sibling here — the store already derives a live enemy-death count (`combatEnemyDeaths`, Cassen's), folded
   *  into his pill. */
  fxBladeAttacksPreview?: number;
  /** TRANSIENT combat-replay preview of FRIENDLY deaths this fight — Cindara's Hoard Avenge (4) tracker ticks
   *  live as her minions fall, instead of being blank in the shop (deaths are combat-internal; there is no run
   *  total). Reset at settle like its spell-cast sibling, so it can never leak into the next fight — a fresh
   *  combat opens at 0, which is exactly the avenge count `simulate` starts each fight from. Display-only:
   *  the real Avenge fires inside `simulate`; this only drives the pill. Counts NON-rise player deaths, the
   *  same bodies `simulate` avenges on (a first Rise returns and is not counted). */
  fxFriendlyDeathPreview?: number;
  /** Fibbsy (Ruby Wealth): activations used THIS turn, reset to 0 each turn. A `usesPerTurn` power fires while
   *  this is below its cap, instead of the plain once-per-turn `heroReady`. */
  heroUsesThisTurn?: number;
  /** Drakko hero: Battlecry minions bought this run (his power grants Drakko the Drummer at 5). */
  drakkoBuys: number;
  /** Chronos hero: End-of-Turn minions bought this run (his Encore quest grants a Chronos at 4). */
  eotMinionBuys?: number;
  /** Cassen hero: enemy minions killed since the last Collision payoff — at 5 it grants a minion of the
   *  board's most common tribe (then subtracts 5). Banks across combats until a minion can be granted. */
  cassenKills: number;
  /** Keshi hero: shop tiers banked toward the next Triple Reward. Every PAID card purchase adds that card's
   *  tier; at 25 Keshi's Crown grants a Triple Reward and this resets to 0 (overflow is discarded, unlike
   *  Cassen's counter which subtracts). Can sit ABOVE 25 while the hand is full — the payout is held, not
   *  spent into nothing. */
  keshiTierPoints: number;
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
  /** Gambler (Dice): the wave at which the Dice power becomes usable again — set to `wave + roll` on use, so a
   *  big roll pays more Gold but locks the power longer. Absent = usable. */
  heroDiceLockUntil?: number;
  /** Aster the Guide (Preparation, tutorial-only): the wave at which the power recharges — set to `wave + 2`
   *  on use so it fires every other turn, in the Dice-lock style. Absent = usable. */
  preparationLockUntil?: number;
  /** Set on a tutorial run so a restored/resumed run knows which course it is (survives a reload); the UI
   *  coaching layer reads it to rehydrate the controller. Absent on every normal run. */
  tutorialCourseId?: string;
  /** Scripted shop for a tutorial run: authored offers per wave, per roll (index 0 = the turn-start roll, 1+ =
   *  successive refreshes). When present + `mode === 'tutorial'`, `rollShop` serves these instead of drawing
   *  from the pool — so the course's lessons always have the cards they need, and nothing touches the shared
   *  pool. Plain data (card ids) so a tutorial run stays serializable and resumable. */
  tutorialShopScript?: { minions: string[]; spell?: string }[][];
  /**
   * TUTORIAL Runeforge script (owner ask 2026-08-22: teach runes on rounds 6 and 9). Keyed by WAVE → the rune
   * ids to offer, and whether it is the Epic forge.
   *
   * Scripted rather than drawn, for the same reason the shop is: `drawRuneOffer` picks at random from ~300
   * runes, and a coached step cannot say "this one gives you X" about a card it did not choose. It also keeps
   * the lesson legible — the course offers runes whose text a first-timer can read in one breath.
   */
  tutorialRuneScript?: Record<number, { runes: string[]; epic?: boolean }>;
  /** Which roll of the current wave the scripted shop is on — 0 at turn start, +1 per refresh; reset on wave
   *  advance. Reads `tutorialShopScript[wave-1][tutorialShopRoll]`. Absent = 0. */
  tutorialShopRoll?: number;
  /** Tutorial only: per-wave flag forcing the PLAYER to strike first (index = wave − 1), so a Rally minion
   *  visibly buffs before it swings. Read into the combat config at `faceOmen`. Absent = the normal rule. */
  tutorialAttackFirst?: boolean[];
  /** Tutorial only: per-wave card id to force the enemy's FIRST swing onto (index = wave − 1); '' or absent =
   *  normal random targeting. Read into the combat config at `faceOmen`. */
  tutorialForceEnemyTarget?: string[];
  /** TUTORIAL ONLY — force every minion Discover to this tribe (Learn Ascent: `beast`). The course teaches one
   *  tribe end to end so a first-time player can actually SEE the synergies, and a Triple Reward that offered a
   *  random off-tribe Tier-4 minion undid that in one pick (owner ask 2026-08-21). Applied at `openDiscover`,
   *  the single point every Discover materializes, so no source can route around it. */
  tutorialDiscoverTribe?: Tribe;
  /** Gambler (Dice): the face most recently rolled, and the wave it was rolled on. Display-only — the panel
   *  keeps showing the number for the REST OF THAT TURN (owner ruling 2026-08-16) instead of snapping back the
   *  moment the tumble settles. A wave comparison expires it, so nothing has to clear it. */
  heroDiceRoll?: number;
  heroDiceRollWave?: number;
  /** Bram (Investment): Gold banked toward the Gilded payout. Resets to 0 the moment it reaches 5. */
  bramInvested?: number;
  /** Croupier Ayse (Lucky Seat): the suit QUEUED UP — which of the four rewards the next payout will be. Chosen
   *  at run start and re-rolled after every payout, never landing on the same suit twice in a row (owner spec
   *  2026-08-16). Public rather than rolled-at-payout precisely because the hero-power BUTTON shows the suit's
   *  art, so the player can see what they are working toward. */
  ciaSuit?: CiaSuit;
  /** Fi / Coran / Runesmith / Guardian: the quest or rune THEIR power granted, once chosen. The power button
   *  wears its art from then on (owner ask 2026-08-17) — the grant IS the power, so it takes the power's slot
   *  rather than sitting in one of the three quest/rune slots. `kind` picks the art index to look it up in. */
  heroGrantArt?: { kind: 'rune' | 'quest'; id: string };
  /** Juggler (Baldgecoin): minions bought toward the next Gold Pouch. Wraps at 3 rather than accumulating. */
  jugglerBuys?: number;
  /** Flash: which end of next combat's kills he is claiming — armed in the shop, spent at settle. Absent when
   *  nothing is armed. Cleared on payout, so it never carries into a second fight. */
  flashPick?: 'first' | 'last';
  /** Cassen: the commission currently in flight, or absent when none is. Only ONE can be active at a time —
   *  the power is unusable while it runs, and the button wears that commission's art until it matures. */
  commission?: Commission;
  /** Cassen: the commission taken LAST, so the next offer can exclude it — "all 3 are offered first, but then
   *  they cannot be offered twice in a row" (owner spec 2026-08-16). Absent on the first offer, which is why
   *  the opening choice shows all three. */
  lastCommission?: CommissionKind;
  /** The hero whose power this run WIELDS in place of its own. Two writers, one field:
   *  · MIMIC re-picks it every turn (the turn-start power Discover);
   *  · POWER SHIFTER (T5 spell) sets it permanently, for ANY hero — which is why this is no longer named
   *    `mimicPowerId` (renamed 2026-08-22; `activePowers` still reads the old key so a run saved between
   *    the two same-day merges keeps its disguise).
   *  Read only through `activePowers`/`hasPower` — a behaviour site comparing `getHero(heroId).power.kind`
   *  directly is blind to it. */
  adoptedPowerId?: string;
  /** @deprecated the pre-rename name for `adoptedPowerId`. Read-only legacy heal; never written. */
  mimicPowerId?: string;
  /** VOID: the two heroes whose powers the run wields from turn 4 on (the turn-4 double Discover). Slot 0 is
   *  the main power button; slot 1 renders as the second button beside the hero. */
  voidPowerIds?: string[];
  /** A hero-power Discover is OPEN: hero ids whose powers are offered, and which pick this is. Modal — the
   *  reducer blocks every action but `pickPower` while set (same contract as `questOffer`). `void1` chains
   *  into a `void2` offer on pick; `mimic` re-opens every turn. */
  powerOffer?: { heroIds: string[]; slot: 'mimic' | 'void1' | 'void2' | 'shifter' };
  /** Hero ids whose ADOPTION reward has already been paid this run (`seedAdoptedPower`). Mimic re-picks every
   *  turn, and without this ledger re-adopting Brackus farmed a Tier-7 Discover per turn — the start-of-game
   *  reward is a once-per-run gift, not a faucet. */
  seededPowers?: string[];
  /** A power Discover WAITING behind another start-of-turn modal (quest offer / forge) — opened by
   *  `openNextStartOfTurnModal` when the queue drains, mirroring `pendingBasicForge`. */
  pendingPowerOffer?: { slot: 'mimic' | 'void1' };  // 'shifter' is cast-driven, never queued at turn start
  /** The SECOND wielded power's per-turn charge (Void slot 1) — `heroReady`'s sibling, re-armed beside it on
   *  every wave advance. Slot 0 keeps the original fields so every existing power is untouched. */
  /**
   * ── EQUIPMENT (owner handoff 2026-08-28) ──────────────────────────────────────────────────────────────
   *
   * AUTHORITATIVE game state, never UI state: replays, reconnects, bots and Doc Bot all read it. It rides in
   * RunState precisely so replay v2 captures it for free — the frame model is inclusion-by-omission, so a new
   * RunState field is persisted with no capture code (see `SHOP_VIEW_EXCLUDED_KEYS`).
   *
   * Rebuilt from the board at every Start of Turn (see `rebuildEquipment`). Within a turn it OUTLIVES its
   * source: selling the Equip minion does not revoke the Equipment until the turn ends.
   */
  equipment?: PlayerEquipmentState;
  /** ADDITIONAL Equipment triggers, stacking additively (handoff). Snapshot at activation, never re-read
   *  while the repeats resolve — a repeat must not reproduce the modifier that created it. No content grants
   *  this yet; it exists so "your Equipment triggers an additional time" is card DATA when it arrives. */
  equipmentExtraTriggers?: number;
  heroReady2?: boolean;
  /** The SECOND power's once-per-game latch (`heroPowerSpent`'s sibling). */
  heroPowerSpent2?: boolean;
  /** The SECOND power's lifetime use count (`heroPowerUses`'s sibling, for maxUses powers). */
  heroPowerUses2?: number;
  /** Croupier Ayse — the ACE's tier-up half: Gold knocked off the NEXT tavern-up, banked until spent. Read
   *  through `upgradeCostOf` (never off `upgradeCost` directly) and cleared by the upgrade that uses it, so a
   *  banked discount survives rerolls and turn rollovers but is only ever spent once. */
  aceTierDiscount?: number;
  /** Croupier Ayse (Lucky Seat): Enchanted cards BOUGHT toward the prize (resets at 3). `enchanted` on a Shop
   *  offer is the mark itself — purely cosmetic on the card, and the only thing that feeds this counter. */
  ciaEnchantedBought?: number;
  /** Harlan (Buyout): the wave his price was last re-based on — the cost falls 1 per turn since. Absent = the
   *  run start, so the discount accrues from turn 1 exactly like Hunch's. */
  harlanResetWave?: number;
  /** Rascal (All In): the wave his payout was last re-based on. Same lifecycle as `harlanResetWave`. */
  rascalResetWave?: number;
  /** Sable (Soulbind): the uids bound THIS turn, and the wave the bond was forged. A stat gain on either
   *  mirrors onto the other — once, never echoing back (owner ruling 2026-08-16). Expired by wave comparison
   *  so nothing has to clear it; the combat sim reads it through `questCombatMods`. */
  sableBond?: { a: string; b: string; wave: number };
  /** Frantic Frank (Clearance): the wave on which his refresh made Shop minions cost 2 Gold. Equal to the
   *  current wave while the discount is live; a wave comparison auto-expires it next turn (no explicit clear). */
  frankClearanceTurn?: number;
  /** Pete (Contrabanana): running count of Shop refreshes — every 3rd appends a tier-above offer. */
  refreshCount?: number;
  /** Emissary Vale (United Front): set once a Fatecarver has been granted on reaching Tier 6, so it happens once. */
  valeFatecarverDone?: boolean;
  /** Quillen (Archive): the tribes of the Shop minions archived so far. Every 3rd archived minion triggers a
   *  Discover of one random minion per recorded tribe (up to tier), then this resets. */
  archivedTribes?: Tribe[];
  /** Solid Ground (spell): the first N minions summoned NEXT combat gain `solidGroundStat`. Spent by the fight. */
  solidGroundLeft?: number;
  solidGroundStat?: number;
  /** Containment Rune (spell): the first ENEMY minion summoned next combat is set to 1/1. Spent by the fight. */
  containFirstEnemySummon?: boolean;
  /** Stolen Initiative (spell): after the enemy's first attack next combat, your right-most minion strikes. */
  stolenInitiative?: boolean;
  /** Gamble (the spell): the die face just rolled + a bump seq, so the UI can play the SAME tumble the
   *  Gambler's hero power uses and hold the card back until it lands. Presentation only — the pull itself
   *  already resolved (deterministic); this just says what to show. Cleared per action like the other FX. */
  gambleRoll?: { tier: number; seq: number };
  /** The hand card Gamble just won — withheld from the hand render until the die lands, then revealed. */
  gambleWonUid?: string;
  /** Hunch (Rounded Spellbook): the wave the power was last used — its 3-Gold cost drops 1 per turn since
   *  (floor 0). Absent = never used, so the countdown runs from wave 1. */
  hunchResetWave?: number;
  /** Tiff (Dragon Tamer): Dragons/spells BOUGHT since the last power use — each drops the power's 5-Gold
   *  cost by 1 (floor 0, see `dragonTamerCostOf`). Reset to 0 when the power fires; persists across turns. */
  tiffDiscount?: number;
  /** Gorr's Four Peat: the cardIds of MINIONS bought THIS turn (reset at turn setup). The 3rd buy conjures a
   *  plain copy of one of the three at random — once per turn (the array keeps growing past 3 but never re-fires). */
  gorrBuys?: string[];
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
  /** Set 2 (Demons) — the most recent SHOP-MINION consume. Deliberately its OWN channel rather than reusing
   *  `fodderEaten` (owner 2026-07-25): eating a tavern minion and eating Fodder are different mechanics and
   *  will get different animations, and sharing one payload meant one couldn't be restyled without the other.
   *  Same shape, so the UI can share choreography until they diverge. Transient, cleared each action. */
  shopEaten?: { uid: string; eaterUid: string; cardId: string; attack: number; health: number; gainA: number; gainH: number }[];
  /** Bumps each time a Shop minion is consumed — the UI keys its own animation off this. */
  shopEatenSeq: number;
  /** Wolvie's borrowed Echo (`deathrattleBuffNextSummon`): buff the NEXT minion summoned in the shop of this
   *  tribe, then clear. One-shot; also cleared at End of Turn so it never leaks into the next shop. */
  pendingSummonBuff?: { tribe: Tribe; attack: number; health: number; source: string };
  /** Transient buff-other FX captured during the CURRENT action (cleared at the top of `reduce`). */
  recruitBuffFx: BuffFxEvent[];
  /** Monotonic bump when `recruitBuffFx` is non-empty after an action — the UI fires once per change. */
  recruitFxSeq: number;
  /** Set 2 (Dwarves) — ale-generation FX metadata: which board UNIT generated a Dwarven Ale during the
   *  CURRENT shop action (Brunni End-of-Turn, Tapkeeper on Gold spent, Doubletap Brewer Shout), so the UI can
   *  burst `ale-bubbles` from that Dwarf. Pure display (no RNG, no stats — determinism/golden unaffected);
   *  transient, cleared at the top of `reduce`, seq bumped when non-empty. Mirrors `recruitBuffFx`. The
   *  Reinforcing-Ale spell also routes through `grantRandomAle` but is NOT a unit, so it records nothing. */
  aleGranted: { sourceUid: string; count: number }[];
  /** Monotonic bump when a Dwarf generates one or more Ales in the shop — the UI keys its burst off this. */
  aleGrantSeq: number;
  /** Dragon uids Karwind just flame-buffed on the most recent Battlecry — the UI flashes flames
   *  on them (on top of the normal buff flash). Transient. */
  karwindFlash?: string[];
  /** Bumps each time Karwind flame-buffs — the UI keys its flame animation off this. */
  karwindFlashSeq: number;
  /** The uid whose `doubleChance` roll just came up (Karwind 2026-08-07) — the UI floats a crit-style "2x"
   *  above that body. Transient: a Shout trigger that does NOT crit clears it. */
  karwindCritUid?: string;
  /** Chaos hero power: bumps each time a Chaos Attachment is granted (every 5th turn), with the new token's
   *  uid — the UI flies it in from the hero portrait. Transient; absent until the first grant. */
  chaosGrantSeq?: number;
  chaosGrantUid?: string;
  /** Displacement swap FX signal (Darah's power + the Displacement spell): bumped by `swapWithTavern` with
   *  the uids of the two NEW cards (the arrival on the board, the displaced offer in the tavern) so the UI
   *  fires the circular swap-arrows effect between their positions. One-shot, like `chaosGrantSeq`. */
  swapFxSeq?: number;
  swapFxBoardUid?: string;
  swapFxShopUid?: string;
  /** Buff Gust FX signal (group buffs): bumped with the uids of every AFFECTED visible card — Fodder in
   *  the board/hand/shop when the run-wide Fodder enchant fires (Ritualist / Rune of Consumption / Bane),
   *  or the whole shop minion row on a Staff of Guel cast — so the UI sweeps the violet gust in from the
   *  affected row's flanks. One-shot, like `swapFxSeq`. */
  buffGustSeq?: number;
  buffGustUids?: string[];
  /** Fodder Infusion FX signal: bumped with the SOURCE card's uid whenever a unit queues Fodder for the
   *  tavern (Maw's End of Turn, Godfodder's pick, Soulfeeder's Shout, Korok's gold meter, Burial Imp) — the
   *  UI reaches tendrils from that unit up to the shop line, "sending" the Fodder. One-shot. */
  fodderSendSeq?: number;
  fodderSendUid?: string;
  /** Aura Wash FX signal: bumped when a run-wide TRIBE-AURA channel ROSE this action — the Undead aura
   *  (Lantern of Souls / Watcher / Forsaken Will), the Imp aura (Imp Overseer / Imp King / Imp Census),
   *  the Attachment aura (Scrap Herald), or the Beast buy-aura (Squirl Scout / Pack quests). Several of
   *  these never touch stored stats (display-fold / future-copy auras), so without this stamp the numbers
   *  would jump with zero feedback. One entry per risen channel: the tribe key (drives the wash's tribe
   *  color), the delta, and the AFFECTED visible uids (board + tavern) the UI blooms the wash over.
   *  One-shot + per-action (cleared at the top of `reduce`), like `recruitBuffFx`. */
  auraFxSeq?: number;
  auraFx?: { tribe: AuraFxTribe; attack: number; health: number; targets: string[] }[];
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
  questFlags?: { bloodTrail?: boolean; echoingCoop?: boolean; lawOfTeeth?: boolean; oldHunt?: number; deepHunger?: boolean; contractRewrite?: boolean; doubleLeftmostAttack?: boolean; feedingLine?: boolean; umbralEnergy?: boolean; emptyGraves?: boolean; crateringMissive?: boolean; passingSpears?: boolean; assemblyLine?: number; runeWarding?: boolean; runeFury?: boolean; runeSlaying?: boolean; runeForthcoming?: boolean; runeRallying?: boolean; runeRisingGraves?: boolean; runeBroodpit?: boolean; runeSpearline?: boolean; runeAppraisal?: boolean; runeSoulTaxes?: boolean; runeFirstClaws?: boolean; runePackcraft?: boolean; runeInheritance?: boolean; runeSalvage?: boolean; runeTwilight?: boolean; runeWarden?: boolean; runeRebirth?: boolean; runeAftershocks?: boolean; runeEngraving?: boolean; runeUnderdog?: boolean; runeGemGolem?: boolean; runeChef?: boolean; runeCarrionCoin?: number; runeFiveBanners?: boolean; runeCenterline?: boolean; runeSecondLitter?: boolean; runeDragonscale?: number; runeTemperedTime?: boolean; runeSavagery?: boolean; runeCrucible?: number; runeHerald?: boolean; runeUndertow?: number | boolean; runeMirrorMarch?: boolean; runeTrophy?: boolean; avengeFirstDouble?: boolean; candlelightToll?: boolean; gemheartCharge?: boolean; burningLegion?: number; runeVanguard?: boolean; runeFinality?: number; runeHatchery?: boolean; runeLastCall?: boolean; runeCinderLedger?: number; runeProcession?: boolean; runeGemstorm?: number; runeBloodAndCoin?: number; runeWildHunt?: number; runeLivingTreasure?: boolean; runeRemains?: number; runeReinvestment?: number; runeHuntingBell?: boolean; runeBrood?: number; runeLivingEchoes?: number; runeWarChorus?: boolean; runeFoodChain?: boolean; runeAttackingGems?: number; runeOverflow?: number; runeCounterpoint?: boolean; runeMammoth?: boolean; runeWarpath?: boolean; runeEmberline?: boolean; runeAshenPayroll?: number; runeBackbeat?: boolean; runeSpareChair?: boolean; runeAncestralRoar?: boolean; runeRubyShrapnel?: boolean; runeSharedScripture?: boolean; runeMoonhowl?: boolean; runeFloodedVault?: boolean; runeBattleRefraction?: boolean; runeWrangler?: boolean; runeLivingGeode?: boolean; runeDawnclaw?: boolean; runeSylus?: boolean; oldPack?: boolean; runeJungle?: boolean; runeBurrow?: boolean; runeBeastialSwarm?: boolean; runeZoo?: boolean; runeRuins?: boolean; runeGolems?: boolean; runeEngravingGems?: boolean; runeHerdingHorn?: boolean; runeDeathtouchedApple?: boolean; runeStokedMenagerie?: boolean; runeReturningPack?: number; runeGraveRefreshment?: number; runeShiftingFacets?: boolean; runeDeepeningVein?: boolean };
  // ── Runeforge (Runesmith) ──
  /** The Runeforge is open (turn 6): a pending offer of rune ids to buy for their Gold cost. Like `questOffer`,
   *  while set the reducer blocks every non-`buyRune`/`skipRuneforge` action and the UI pauses the timer; buying
   *  (or skipping) clears it. Opens exactly once (the hero power is `oncePerGame`). */
  runeforgeOffer?: string[];
  /** The Runeforge's single re-roll (2 Gold) has been used this visit — the offer can't be re-rolled again. */
  runeforgeRerolled?: boolean;
  /** Per-slot Gold discounts aligned with `runeforgeOffer` — the PIVOT discount (a seeded chance on offered
   *  runes that do NOT follow the board, easing a direction change; owner ask 2026-07-31). Cleared with the
   *  offer; recomputed on a re-roll. */
  runeforgeDiscounts?: (number | undefined)[];
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
  /**
   * Rune of the Merchant's Chorus: a shop buff scoped to THIS TURN. Deliberately separate from
   * `tavernBuyBonus` (which is permanent and every future roll inherits): this one accumulates across every
   * shop you roll within the turn, then is wiped at the rollover, so a Shout-heavy turn spikes the row without
   * compounding forever. Cleared alongside the other per-turn tallies in `reducer.ts`.
   */
  tavernBuyBonusTurn?: { atk: number; hp: number };
  // ── 2026-08-19 owner rune batch ────────────────────────────────────────────────────────────────────────
  /** Rune of Basic/Epic <tribe>: each armed entry conjures `count` random minions of `tribe` at turn setup.
   *  An ARRAY so holding several tribe runes stacks rather than the last one winning. */
  runeTribeDrip?: { tribe: Tribe; count: number }[];
  /** Rune of Hoardflame / Dragon Breath: these spell ids each cast one extra time (card-scoped multicast,
   *  read by `spellCasts` — which is also what the UI's ×N badge previews). */
  runeSpellDouble?: string[];
  /** Rune of the Glider: whenever you play a card, give a Dragon +atk/+hp. */
  runeGlider?: { attack: number; health: number };
  /** Rune of the Pendant: at each turn setup, gild a random friendly minion of this tier or below. */
  runePendant?: number;
  /** Rune of the War Drum: how many EXTRA times the turn's one charged Shout triggers. */
  runeWarDrum?: number;
  /** Rune of the War Drum: spent for the turn once the charge has been used (drives the 1/0 charge readout). */
  runeWarDrumUsedThisTurn?: boolean;
  /** Rune of the Baller: `step` is the per-sale climb; `sales` is how many minions have been sold since it was
   *  taken, which decides both the magnitude (step x sales) and which stat it lands on (odd = Attack). */
  runeBaller?: { step: number; sales: number };
  /** Rune of the Embers: every refresh doubles the right-most Shop minion's Health. */
  runeEmbers?: boolean;
  /** Rune of Refreshments: playing a Demon banks a free Shop refresh. */
  runeRefreshments?: boolean;
  /** Summoning Bulwark: minions-summoned-gain-Taunt banked for the NEXT combat. Cleared at the turn rollover. */
  summonTauntsNextCombat?: number;
  /** Rune of the Wishbone: the Hero Power triggers twice (gated to `DOUBLEABLE_POWERS`). */
  runeWishbone?: boolean;
  /** Rune of Rising Echoes: keywords the NEXT Discover pick arrives carrying (consumed with the pick). */
  discoverKeywords?: Keyword[];
  /** Rune of the Chipper Sticker: playing a Demon makes another friendly Demon eat a Shop minion. */
  runeChipperSticker?: boolean;
  // ── 2026-08-20 owner rune batch ──────────────────────────────────────────────────────────────────────
  /** Cadenced twin of `questRecurringGrants` — a card handed over every `everyTurns` turn setups instead of
   *  every one (Clockwork Promotion / the Muckbroker / Rare Goods). `tick` counts turn setups since the last
   *  payout; `sourceId` lets the badge show its x/N countdown. A LIST, so several can be held at once. */
  runeCadenceGrants?: { cardId: string; everyTurns: number; tick: number; sourceId?: string }[];
  /** Rune of Living Magic (`uses: 1`) / Perfect Recall (`uses: 2`): after you cast a Shop spell, a copy lands
   *  in hand — `uses` times per turn. ONE budget for both runes: holding both raises the ceiling rather than
   *  the two firing independently, exactly like the Mage-Pup teach cap. `used` resets at the rollover. */
  runeSpellEcho?: { uses: number; used: number };
  /** Rune of Draconic Curiosity: taking a Dragon from a Discover hands over a random Shop spell. */
  runeDraconicCuriosity?: boolean;
  /** Rune of the Seasoned Ledger: every minion played gains +attack/+health, improving by the same after every
   *  `per` minions. `played` is the running count — the badge prints both the live grant and the countdown. */
  runeSeasonedLedger?: { attack: number; health: number; per: number; played: number };
  /** Rune of Echoed Arrival: every `per`-th ECHO minion played triggers its Echo. `tick` is the live count. */
  runeEchoedArrival?: { per: number; tick: number };
  /** Rune of Shared Spoils: a stat gain on the left-most Dwarf is mirrored onto the right-most Dwarf. */
  runeSharedSpoils?: boolean;
  /** Rune of Heavy Payroll: a Dwarf arriving in hand pays your left-most minion. */
  runeHeavyPayroll?: { attack: number; health: number };
  /** Rune of Shifting Facets: how many turn setups have passed since it was taken. Even = Health (the printed
   *  starting axis), odd = Attack — so the axis in force is derived, never separately stored. */
  runeShiftingFacetsTick?: number;
  /** Rune of Might: every Shop spell you cast also casts Might of Aeon. */
  runeMight?: boolean;
  /** Re-entry latch for the above — the triggered cast must not re-trigger the hook that cast it. */
  runeMightCasting?: boolean;
  /** Rune of Kindling: each spell you cast gives your left- and right-most minions +4/+6. */
  runeKindling?: boolean;
  /** Rune of Scales: each spell you cast gives your Dragons +1/+1 (board + hand). */
  runeScales?: boolean;
  runeLongShift?: boolean;
  /** RUNE OF HAPPY BIRTHDAY: a random Gift on purchase, then another every 2 turns (`giftBirthdayTick` counts
   *  the waves between payouts). */
  runeHappyBirthday?: boolean;
  giftBirthdayTick?: number;
  /** RUNE OF MERRY CHRISTMAS (epic): Discover a Gift on purchase, then again every Start of Turn. */
  runeMerryChristmas?: boolean;
  /** Rune of Bartering: your Shout (Battlecry) minions sell for 2 Gold. */
  runeBartering?: boolean;
  /** Rune of Twin Gilding: you only need 2 copies of a card to Gild (triple) it. */
  runeTwinGilding?: boolean;
  /** Rune of the Den Mother: your Den Mother also buffs herself when she buffs another Beast. */
  runeDenMother?: boolean;
  /** Rune of the Display Case: your Market Tormentors also enchant the LEFT-most Shop slot. */
  runeDisplayCase?: boolean;
  /** Rune of Blart: your Bob Blarts gain BOTH the left and right-most Shop minions' stats at End of Turn. */
  runeBlart?: boolean;
  /** Rune of the Vaultkeeper: your Vaultkeepers also give their per-Dragon grant to an adjacent minion. */
  runeVaultkeeper?: boolean;
  // ── Aug-11 economy runes ──
  runeSellersMarket?: boolean;   // sell → board +4/+3
  runeFreshPages?: boolean;      // Discover a Shop spell, repeated every Start of Turn
  runeStrangeCaravan?: boolean;  // Start of Turn: a random minion from an uncontrolled type
  runeWindowShopping?: boolean;  // first 3 Refreshes each turn are free
  runeOpenEnrollment?: boolean;  // after a Refresh, offer an extra dominant-type minion
  runeShopkeep?: boolean;        // upgrade cost −3, repeated each End of Turn
  runeTradeIn?: boolean;         // first sale each turn → next minion of that type costs 1 less
  runeRestocking?: boolean;      // first buy each turn refills its slot with a same-Tier 2-Gold minion
  runeCollector?: boolean;       // 3 types bought in a turn → Discover from one of them (once/turn)
  runeBargainBin?: boolean;      // first Refresh each turn fills the Shop with 1-Gold minions that sell for 0
  /** Window Shopping: refreshes used this turn (the first 3 are free). Reset each turn. */
  windowShopRolls?: number;
  /** Restocking / Bargain Bin / Collector once-per-turn latches (reset each turn). Restocking's counts USES
   *  (a duplicate widens its window to one restock per copy — owner 2026-08-27); `true` = 1 in older saves. */
  restockUsedThisTurn?: number | boolean;
  bargainBinUsedThisTurn?: number | boolean; // counts uses since 2026-08-27 (duplicate widens the window); `true` = 1 in older saves
  collectorUsedThisTurn?: boolean;
  /** Trade-In: the tribe of your first sale this turn — arms a 1-Gold discount on the next minion of that type. */
  tradeInTribe?: Tribe;
  /** Collector: the distinct minion tribes you've bought this turn (reset each turn). */
  typesBoughtThisTurn?: Tribe[];
  /** Rune ids bought this run — shown as permanent run-buff badges (above the hero panel). */
  ownedRunes?: string[];
  /** RUNE DUPLICATE STACKING (owner rulings 2026-08-27): how many times each rune's reward has APPLIED this
   *  run — ticked once per application (buy, Rune of Duplication's copy, a granted rune). Consumers read
   *  `runeStacksOf` (min 1) to scale their output, so a single copy — and every legacy save from before the
   *  counter — behaves byte-identically. Sweetener-only duplicates (see `runeDup.ts`) never tick this: their
   *  duplicate pays Gold + a refresh instead of re-applying the reward. */
  runeStacks?: Record<string, number>;
  /** HENCHMAN decay (owner spec 2026-08-03): Gold knocked off the hero's henchman cost so far — +3 per round
   *  WON, +2 per round lost, accrued at combat settle. Effective price = `henchmanCostOf` (floored at 0).
   *  Absent = 0. Lives on the run, not the card, so the printed def stays pure data. */
  henchmanDiscount?: number;
  /** The henchman is once per run — set by `buyHenchman`, read by the UI to retire the recruit button. */
  henchmanBought?: boolean;
  /** CELESTIAL HUD sparks (transient UI-fx channel, same pattern as `karwindFlash`): bumped when a play
   *  lands on a side or an aligned effect fires, so the alignment strip can flash that side. `sides` is
   *  which halves spark this beat (eclipse = both). Presentation-only — never read by rules. */
  alignSpark?: { seq: number; sides: ('dawn' | 'dusk')[] };
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
  runeScale?: { count: number; attack: number; health: number; per?: number; tick?: number };
  /** Reward KIND → the rune id that installed it, recorded at purchase. This is what lets a trigger site deep
   *  in the reducer stamp `runeProcs` with a one-line `procRune(s, 'runeBrew')` instead of re-deriving which
   *  rune owns the flag it just read — the flags are booleans scattered across `RunState` and none of them
   *  remembers where it came from. One entry per kind is enough: a kind is installed by exactly one rune. */
  runeIdByKind?: Record<string, string>;
  /** Cumulative payout count per rune id — "how many times has this rune's effect actually fired". Purely a
   *  display signal (the badge burst + bounce read it); the sim never branches on it. Cumulative rather than
   *  a one-shot flag so the UI can edge-detect without a seq, and so a payout that pays TWICE in one action
   *  (Bulk Order banking 10 Gold at 5-per) still reads as two fires. */
  runeProcs?: Record<string, number>;
  /** Rune of Lasting Cadence (Epic) — End of Turn: trigger ALL your Rally effects, one beat per rally
   *  (`runeLastingCadenceBeats` / `fireShopRally`). Was a Start-of-Combat combat flag until the Effect Arena's
   *  Rally family made a shop dispatch possible. */
  runeLastingCadence?: boolean;
  /** Rune of Combat Prowess (Epic) — your Start of Combat effects ALSO trigger at End of Turn, one beat per
   *  (body x effect) (`runeCombatProwessBeats` / `fireShopStartOfCombat`) — the second cross-phase dispatcher
   *  rune, built on the Lasting Cadence pattern. */
  runeCombatProwess?: boolean;
  /** Rune of Copies (Epic): copy a random board minion to hand at the start of every turn. */
  runeCopies?: boolean;
  /** Rune of Tempering: the FIRST Attachment (Magnetic) you play each turn also gives that minion Ward. */
  runeTempering?: boolean;
  /** Rune of Replication (Epic): the FIRST Attachment you play each turn also welds a copy onto your leftmost Mech. */
  runeReplication?: boolean;
  /** Rune of Refrain: after you play your THIRD Shout (Battlecry) minion each turn, the first Shout minion you
   *  played that turn returns to your hand (the actual instance, buffs intact). */
  runeRefrain?: boolean;
  /** Rune of the Coffers: End of Turn, max Gold +1. */
  runeCoffers?: boolean;
  /** Rune of Enchantment: each Shop-spell cast gives your minions +1/+1 (permanent). */
  runeEnchantment?: boolean;
  /** Rune of the Crown: once `spellsCast` reaches `per`, your spells give +attack/+health extra. */
  runeCrown?: { per: number; attack: number; health: number };
  /** Rune of the Lapidary (owner rework 2026-08-11): End of Turn, play a Ruby on a random minion for every
   *  card played this turn. Runs as a VIRTUAL recurring-EoT entry (see `recurringEotEffects`). */
  runeLapidary?: boolean;
  /** Rune of the Deep: each turn setup, a random minion of this tier. */
  runeDeep?: number;
  /** Rune of the Guiding Candle: refreshes left THIS TURN that draw only `tier` minions. Reset each turn. */
  runeGuidingCandle?: { count: number; tier: number; left: number };
  /** Rune of the Muster: armed free refreshes stocked with plain copies of the board, spent one per refresh.
   *  A NUMBER counts armed musters (a duplicate re-arms — owner one-shot ruling 2026-08-27: two copies make
   *  the first TWO refreshes musters); legacy saves hold `true` = 1. */
  runeMuster?: number | boolean;
  /** Rune of the Foundry: minions sold toward `per` — a random Dragon each time it fills. */
  runeFoundry?: { per: number; sold: number };
  /** Rune of the Corrupted Tome: a Triple Reward grants two. */
  runeCorruptedTome?: boolean;
  /** Rune of the Groveweaver: a Groveweaver's summon grant also lands on the Groveweaver. */
  runeGroveweaver?: boolean;
  /** Rune of Shared Pour: the first Dwarven Ale each turn casts one extra time. */
  runeSharedPour?: boolean;
  /** Rune of the Aftermarket: the first minion sold each turn feeds the current Shop its base stats. */
  runeAftermarket?: boolean;
  /** Rune of Spellhide: the turn's first stat-granting Shop spell cast on a Beast, re-cast at Start of Combat. */
  runeSpellhide?: boolean;
  spellhidePending?: { spellId: string; uid: string }[];
  spellhideUsedThisTurn?: boolean;
  /** Rune of the Spellmarket: the turn's first stat spell on a friend also feeds the right-most Shop offer. */
  runeSpellmarket?: boolean;
  spellmarketUsedThisTurn?: boolean;
  /** Rune of the Last Word: the turn's first sold Dragon-with-a-Shout triggers it on the way out. */
  runeLastWord?: boolean;
  lastWordUsedThisTurn?: boolean;
  /** Rune of the Runic Hoard: a Shop spell copied to hand gives your Dragons +1/+1. */
  runeRunicHoard?: boolean;
  /** Rune of the Banquet Hall: the turn's first Shop-buffed buy feeds one friendly minion of each type. */
  runeBanquetHall?: boolean;
  banquetUsedThisTurn?: boolean;
  /** Rune of the Crucible Choir: End of Turn, the left-most Shout then the left-most Echo. */
  runeCrucibleChoir?: boolean;
  /** Rune of Full Measure: Baby Gastrid's grant also pays Attack, 1:1 with the Health. */
  runeFullMeasure?: boolean;
  /** Rune of Mountain Trade: a Mountainbond Ruby play also hands over a random Dwarven Ale. */
  runeMountainTrade?: boolean;
  /** Rune of Open Appetite: Appetite Agent's aim loses its Demon-only restriction. */
  runeOpenAppetite?: boolean;
  /** Rune of the Broodmaster: a Broodwright's Imp buff also lands on the Broodwright. */
  runeBroodmaster?: boolean;
  /** Rune of the Second Life: your Scavvers carry Taunt + Rise. */
  runeSecondLife?: boolean;
  /** Rune of Shared Reflection: the first Shop spell cast on each Mirrorwing per turn also casts on its
   *  adjacent Dragons. */
  runeSharedReflection?: boolean;
  /** Rune of the Unbroken Vein: a Veinbreaker applies BOTH Choose One options, no prompt. */
  runeUnbrokenVein?: boolean;
  /** Rune of Living Growth: each Growth Mushy creates improves the Growth spell permanently. */
  runeLivingGrowth?: boolean;
  /** Living Growth's accrued improvement — added to every Growth cast (shop and combat). */
  growthBonus?: number;
  /** Rune of Hoardcalling: the first Dragon Shout each turn grants a random Shop spell. */
  runeHoardcalling?: boolean;
  /** Per-turn gates for the three above — reset at the turn rollover. */
  sharedPourUsedThisTurn?: boolean;
  aftermarketUsedThisTurn?: boolean;
  hoardcallingUsedThisTurn?: boolean;
  /** Rune of the Conduit: every Ruby played bounces its stats to one extra random friendly minion. */
  runeConduit?: boolean;
  /** Rune of the Vault: 10 Gold when the shop first reaches tier 5. Cleared when paid. */
  runeVault?: boolean;
  /** Rune of Lorekeeping: a Shop spell cast ON a minion gives it an extra +4/+4. */
  runeLorekeeping?: boolean;
  /** Rune of Thrift: stat-granting Shop spells cost 2 less. */
  runeThrift?: boolean;
  /** Rune of the Flagship: each Shop-spell cast gives your Dwarves +2/+2. */
  runeFlagship?: boolean;
  /** Rune of the Brew: each Gold spend gives a random friendly Dwarf +4/+3. */
  runeBrew?: boolean;
  /** Rune of Transcription: the next N bought minions each come with a free copy. Counts DOWN. */
  runeTranscription?: number;
  /** Rune of the Treasure Map: [turns remaining, payout]. Ticks at turn start; pays and clears at 0.
   *  LEGACY single slot — new purchases go through `runeTreasureMaps` (an array, so a duplicate schedules a
   *  SECOND payout instead of resetting the first countdown — owner one-shot ruling 2026-08-27). Old saves
   *  holding this field still tick and pay it. */
  runeTreasureMap?: { turns: number; gold: number };
  /** Rune of the Treasure Map purchases in flight — each entry is its own countdown + payout. */
  runeTreasureMaps?: { turns: number; gold: number }[];
  /** Rune of the Golden Splinter: pay a random Golden T`tier` minion when Gold reaches `at`. Once — cleared. */
  runeGoldenSplinter?: { at: number; tier: number };
  /** Rune of Transfusion (Epic): whenever a Demon Consumes Fodder, your leftmost minion also gains the Fodder's stats. */
  runeTransfusion?: boolean;
  /** Rune of Endless Appetite (Epic): the FIRST Fodder Consume each turn fans out — every OTHER friendly Demon
   *  Consumes a copy of the same Fodder. */
  runeEndlessAppetite?: boolean;
  /** Rune of Held Strength (Epic, owner rework 2026-08-27 — was a one-shot on purchase): Start of Combat,
   *  your left and right-most minions gain the stats of the left-most (non-spell) card in your hand. Armed
   *  here; the held stats are read live at combat build (`questCombatMods`), and a duplicate fires the grant
   *  once per copy. */
  runeHeldStrength?: boolean;
  /** Rune of the Conductor (Epic): at the start of every shop, trigger all your End of Turn effects. */
  runeConductor?: boolean;
  /** Rune of Mastery (Epic): whenever one of your effects Improves, it improves an additional time — every
   *  Improve-text card's improvement step applies ×2, in the shop AND in combat (via QuestCombatMods). */
  runeMastery?: boolean;
  /** Attachments (Magnetic cards) PLAYED this turn — Tempering/Replication's "first each turn" gate. Reset each wave. */
  attachmentsThisTurn?: number;
  /** Shout (Battlecry) minions played this turn + the board uid of the FIRST one — Rune of Refrain. Reset each wave. */
  shoutsThisTurn?: number;
  firstShoutUid?: string;
  /** Fodder Consumes performed this turn — Endless Appetite's "first each turn" gate. Reset each wave. */
  consumesThisTurn?: number;
  /** The FIRST spell cast this turn (Rune of Recurrence recasts it at End of Turn). Reset each wave. */
  firstSpellThisTurnId?: string;
  /** Weld FX signal (2026-07-18): monotonic seq + EVERY uid that gained an Attachment on this weld, and
   *  whether it came from a hand-PLAYED Magnetic (the card slides in first) or an AUTO effect (Banksly,
   *  Combinator, Cling Drones, Money Bots). Plural because ONE weld can land on several minions: a Beatbot
   *  MIRRORS every weld onto itself, so the host and every Beatbot must all animate. Pure display metadata —
   *  never read by the sim. Never cleared; the UI dedupes against a ref of the last-seen seq. */
  weldFxSeq?: number;
  /** Bumped whenever SPELL POWER GOES UP this action, by any source and any amount (Cinderwing Matron's
   *  Shout, a quest reward, a rune, the hero's amplify …) — the UI fires the Spell Power FX (rising arrows +
   *  blast + the floating gain) once per bump. One-shot, like `swapFxSeq`. Stamped from the before/after
   *  state delta rather than a per-action scratch field, so a batch of dispatches can't drop it the way the
   *  weld FX once did. */
  spellPowerFxSeq?: number;
  /** The spell-power INCREASE to print alongside that FX (Attack / Health), captured at stamp time so the
   *  number is the gain this action produced rather than whatever the run drifts to before the UI reads it.
   *  Two stats because spell power is a PAIR — Cinderwing Matron grants Health only. */
  spellPowerFxAtk?: number;
  spellPowerFxHp?: number;
  /** The uid of the card that drove the gain, so the flourish plays OVER it rather than over the row
   *  (owner ask 2026-07-21). Absent when the source isn't a card the player acted on — a quest reward or a
   *  rune tick — and the UI falls back to the shop row for those. */
  spellPowerFxUid?: string;
  /** Bumped whenever RUBY POWER (`rubyBonus`) GOES UP this action, by any source and any amount — the Ruby-side
   *  sibling of `spellPowerFxSeq`, and stamped the same way: from the before/after state delta, so a batch of
   *  dispatches can't drop it. Covers the shop, End of Turn, and the combat carry-back (Veinbreaker's Avenge
   *  raises Ruby strength mid-fight and it settles here). One-shot; the UI dedupes against the last-seen seq. */
  rubyPowerFxSeq?: number;
  /** The ruby-power INCREASE to print alongside that FX (Attack / Health), captured at stamp time. A pair for
   *  the same reason spell power is — a source can grant Health only. */
  rubyPowerFxAtk?: number;
  rubyPowerFxHp?: number;
  /** The uid of the card that drove the gain, so the flourish plays OVER it. Absent for sourceless gains (a
   *  quest/rune tick, or the combat carry-back, whose source unit is gone by settle) — the UI falls back to the
   *  hand's Rubies for those, which is what actually got stronger. */
  rubyPowerFxUid?: string;
  /** Bumped once per action in which one or more RUBIES LANDED on board minions — the recruit-phase half of the
   *  Ruby-landed cue (the combat half rides the `ruby` flag on the `buff` combat event). Distinct from
   *  `rubyPowerFxSeq` above, which fires when your Rubies get STRONGER and explicitly never per cast: this one
   *  is per cast and says nothing about strength.
   *
   *  Derived from the before/after delta of each board card's `rubiesOnThisTurn` rather than stamped by the
   *  play path, for the same reason the two power cues are: a scratch field set mid-action can be swallowed by
   *  React batching, and `rubiesOnThisTurn` is already bumped by `fireOnRubyPlayed` for EVERY recruit Ruby —
   *  your drag from hand, Crownvein's board-wide play, End of Turn mints, all of it — so one delta covers
   *  every source without touching a single play site. */
  rubyLandedFxSeq?: number;
  /** Every card a Ruby landed on this action — board minions first, then TAVERN OFFERS (a Ruby targets `any`,
   *  so it can buff a minion before you buy it). A LIST, not a single uid, because one card can play Rubies
   *  across the whole board (Frenzied Excavator, Ruby Excavation); the UI staggers the cue down this list so a
   *  seven-minion play reads as a sweep instead of one indistinct flash.
   *
   *  Measured off the 'Ruby' BUFF COUNT rather than `rubiesOnThisTurn`, because that counter only moves via
   *  `fireOnRubyPlayed` and two live paths skip it — the offer path deliberately, Frenzied Excavator's
   *  `battlecryPlayRubiesAll` apparently by oversight. Every path that applies a Ruby goes through
   *  `addBuff`/`addOfferBuff`, so their per-source count is the one probe that sees all of them. Not stamped on
   *  the combat-settle actions: the carry-back re-labels mid-fight Ruby gains as 'Ruby' buffs, and the replay
   *  already played this cue for those. */
  rubyLandedFx?: RubyLandedFx[];
  /**
   * SHOP DEATH + ECHO CUES (owner ask 2026-08-28). The shop has no beat playback — only End of Turn plays
   * beats — so these two visuals ride the same per-action scratch channel every other shop FX uses.
   *
   *   · `death`: the body died or was destroyed → the authored `death-dissolve`.
   *   · `echo`:  an Echo TRIGGERED → `pixiFx.deathrattle`, the same skull-shatter combat plays. Fired from
   *              ANY source — a shop destroy, Ossuary Rite, Rune of the Reliquary, a Gravetwin's copy —
   *              because the owner's rule is that an Echo looks like an Echo wherever it happens.
   *
   * One entry per event, in fire order. Cleared at the top of `reduce` like the other scratch buffers, and
   * seq-gated by `shopFxSeq` so a repeated payload still fires exactly once per action.
   */
  /**
   * EQUIP / RE-EQUIP CUES (owner ask 2026-08-28). Per-action scratch, on the same channel every other shop FX
   * uses — the shop has no beat playback, so the animation rides a cue list rather than a beat.
   *
   * One entry PER SOURCE BODY, in board order: duplicate Equip minions collapse into ONE selector entry but
   * each still gets its own re-equip flash, which is what the handoff asks for.
   */
  equipFx?: EquipFx[];
  /** Monotonic gate for `equipFx` — the UI plays a batch when this changes, never on payload identity. */
  equipFxSeq?: number;
  shopDeathFx?: ShopDeathFx[];
  /** Monotonic gate for `shopDeathFx` — the UI plays a batch when this changes, never on payload identity. */
  shopFxSeq?: number;
  /** Transient per-action scratch: the offers Veinstorm just gemmed (set by `stampVeinstormRubies`'s callers,
   *  cleared at the top of `reduce`). Read once in the post-action FX block, which turns it into `veinstormFx`
   *  AND excludes these uids from `rubyLandedFx` so a gemmed offer never fires both the span and the per-card
   *  cue. Not the signal itself — the seq-bumped `veinstormFx` below is what the UI watches. */
  veinstormStamped?: VeinstormFx;
  /** The Veinstorm shop-gem signal — the offers gemmed + whether it was a refresh. Seq-gated like the other FX
   *  payloads so the UI fires once per action even if the payload repeats. */
  veinstormFx?: VeinstormFx;
  veinstormFxSeq?: number;
  /** The RUN-WIDE shop-buff signal — every offer gained +A/+H from `tavernBuyBonus`. Seq-gated like the other
   *  FX payloads so the UI fires once per action even if the payload repeats. Set in the post-action FX block
   *  by diffing the channel, so any future card or quest that raises it animates with no extra wiring. */
  shopBuffAllFx?: ShopBuffAllFx;
  shopBuffAllFxSeq?: number;
  /** Board/hand uids a RUNE buffed this action (shop phase) — the UI plays `rune-buff-unit` on each. Diffed
   *  from `runeBuffMagnitude` so any rune buff, from any of the ~30 sites, animates with no per-site wiring.
   *  Seq-gated like the other FX payloads. Combat + End-of-Turn rune buffs ride their own channels. */
  runeBuffFxUnits?: string[];
  runeBuffFxSeq?: number;
  /** Quest/rune End-of-Turn rewards that TRIGGERED a specific unit this action — one entry per proc, in fire
   *  order. The UI draws a gold tendril from that quest's node to the unit it hit (owner ask 2026-07-21).
   *  Source is the effect id (the node is looked up from it), not the quest id, because runes grant these too
   *  and a rune has its own badge in the same row. Cleared per action like the other transient FX fields. */
  questTendrilFx?: { effect: string; uid: string }[];
  /** Bumped when `questTendrilFx` is refilled, so the UI fires once per action even if the list repeats. */
  questTendrilSeq?: number;
  weldFxUids?: string[];
  weldFxKind?: 'play' | 'auto';
  /** `weldFxSeq` as of the start of the current action — lets `stampWeldFx` tell its first stamp of an
   *  action (replace `weldFxUids`) from later ones (accumulate) without `reduce` clearing the payload,
   *  which raced React's dispatch batching. Bookkeeping only; never read by the sim or the UI. */
  weldFxBaseSeq?: number;
  /** Consecutive combat losses (a win resets; a draw preserves) — the matchmaking loss-streak softener input. */
  lossStreak?: number;
  /** The once-per-streak softener already influenced a pick this streak — disarmed until a win re-arms it. */
  streakSoftened?: boolean;
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
  /** GIFT — Demand an Encore: extra Shout triggers for THIS TURN only (the turn-scoped sibling of
   *  `shoutExtraAlways`, which is permanent). Summed by `playedShoutRepeats` in the shop, threaded into
   *  combat as `questCombatMods.encoreExtra` (R-TURN-01, owner ruling 2026-08-27: "this turn" runs shop
   *  through that turn's combat), and cleared at the turn rollover. */
  shoutExtraTurn?: number;
  /** GIFT — Royal Allowance: once cast, every Start of Turn grants another Gold Pouch for the rest of the run. */
  giftAllowance?: boolean;
  /** GIFT — Arcane Clearance: Shop Spells cost this much less THIS TURN (cleared on wave advance). Distinct
   *  from `spellCostMod`, which is the permanent run-wide channel. */
  spellCostOffTurn?: number;
  /** GIFT — Friends and Family: shop MINIONS cost this much less this turn (cleared on wave advance). */
  minionCostOffTurn?: number;
  /** Per-ACTION scratch: hand-card uids `fireOnGainCard` has already fired for this action. The chokepoint
   *  helpers (`conjureToHand`, `mintRubies`) fire as they push — that is their documented contract — while
   *  `reduce` ALSO diffs the hand so the ~17 other insertion sites can't silently skip the trigger. This ledger
   *  is what keeps the two from double-firing on the same card. Cleared at the top of every action. */
  gainCardFiredUids?: string[];
  /** FUNERAL ON LOAN: the uid of a board body that occupies its slot but is ALREADY DOOMED — the borrowed
   *  minion, spliced in only so positional Echoes (Dawnclaw's neighbours, Legion Shepherd's counting) see a
   *  real board, and removed the instant its Echo finishes. Summon capacity must not count it: it is leaving,
   *  so its slot is free for whatever its own Echo summons (owner report 2026-08-26 — an Echo that summons did
   *  nothing on a 6-body board, because the borrowed body made it read as 7). Transient, one action wide. */
  vacatingUid?: string;
  /** A body that has LANDED and is about to die — the shop's two-step death (owner design 2026-08-28: "the
   *  minion should be coded to literally land as if it was played, but then the immediate next action is that
   *  it is destroyed").
   *
   *  Funeral on Loan's borrowed minion really takes its slot, and Graverobber's victim is really still there,
   *  for one committed state — so the UI draws a minion landing and then dying, instead of a board that
   *  silently has one fewer card. The follow-up is the `resolveShopDeath` action.
   *
   *  IT CAN NEVER LINGER. Every other action resolves it FIRST (`settlePendingDeath`), and deserialize
   *  resolves it on load, so gameplay is identical whether or not the UI ever dispatches the follow-up: a bot,
   *  a test or a replay that just keeps acting gets the same result as a player who watched the animation. */
  pendingDeath?: {
    uid: string;
    /** `loan` also fires the borrowed card's Echo on resolve; `destroy` has already fired its Shout. */
    kind: 'loan' | 'destroy';
  };
  /** The run has already taken its ONE Epic Runeforge early (Rune of the Ornate Clock: "next turn instead of
   *  turn 9"), so the standing turn-9 forge must not also open. */
  epicForgeClaimed?: boolean;
  /** Set 2 — Elderhorn (Choose One). Extra fires its chosen mode grants to BEAST triggers:
   *  `beastHuntExtra` covers RALLIES only (narrowed 2026-07-31), `beastRitualExtra` covers Echoes. Golden
   *  grants 2 instead of 1 per mode. Run-level so they survive combats, passed into the fight via
   *  `CombatSideState` (the same route `handSpellIds` takes). Absent = 0. */
  beastHuntExtra?: number;
  beastRitualExtra?: number;
  /** Set 2 — Moonhowl Mentor: how many spell-buys it has taught this turn, against its once/twice-per-turn
   *  cap. Reset each turn alongside the other per-turn counters. */
  moonhowlTeachesThisTurn?: number;
  shoutFirstDoubleEachRound?: boolean;
  shoutFirstUsedThisTurn?: boolean;
  /** Transient: how many times the LAST played Battlecry fired (Drakko + shout-repeat rewards + charges) — set
   *  during the play, read by the reducer's Shout quest tick so it counts triggers without re-consuming. */
  lastShoutFires?: number;
  /** Transient per-action count of SHOP Rally fires (Rune of Lasting Cadence) — set by `fireShopRally`,
   *  read by the reducer's rally quest tick, zeroed per action like `lastShoutFires`. A shop rally counts
   *  toward the `rally` objective + Author's Hand exactly like a combat one (owner ruling 2026-08-20). */
  lastRallyFires?: number;
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
  /** The first-Echo bonus's SHOP scope (owner principle 2026-08-20: trigger multipliers follow the trigger to
   *  whatever phase it fires in): the first Echo triggered in the SHOP each turn also fires
   *  `echoFirstEachCombat` extra times. Consumed by `fireRecruitDeathrattles`, reset as each wave's shop
   *  opens — the shop analogue of combat's per-fight `firstEchoDone`. Transient bookkeeping, not a reward. */
  echoFirstUsedThisTurn?: boolean;
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
  /** The limited-time "rift" this run was created under, snapshotted from `activeRift()` at `createRun`
   *  so a saved/replayed run keeps its rules even after we flip the global switch off. `undefined`/`null` =
   *  no rift. See `RIFTS` in config.ts. */
  rift?: RiftId | null;
  /** The card SET this run was created under, snapshotted from `activeSet()` at `createRun` — the same
   *  "pin what actually happened" rule as `rift`, and load-bearing for a different reason: shop draws index
   *  into this set's pool, so a run resumed or replayed after the active set flips MUST keep drawing from
   *  the pool it was played under or every subsequent roll diverges. Read it via `poolOf(state)`, never
   *  `activeSet()`. Absent on saves written before sets existed → treated as `set1`. See `SETS` in content. */
  setId?: SetId;
  /** `'freedom'` rift: the first minion bought each turn is free — set once that freebie is spent this
   *  turn, cleared at the start of the next turn. */
  freeBuyUsedThisTurn?: boolean;
  spellDoubleAlways?: boolean;
  /** Tier-7 ACCESS granted by a hero power or quest (owner ruling 2026-07-28) — the non-rift route to Tier 7.
   *  Read only through `hasTier7Access`. Fi's **Open Road** and Coran's **Summit Passage** are its first
   *  writers (2026-08-21); before them the flag was a seam nothing set. */
  tier7Access?: boolean;
  /** Fi's **First Pick**: the first shop MINION bought each turn is free. Shares the Freedom rift's
   *  `freeBuyUsedThisTurn` spend-marker, so owning both never grants two freebies in a turn. */
  questFreeFirstBuy?: boolean;
  /** Coran's **Gilded Shortcut**: how many copies a Gild needs (2). Read through `gildCopiesNeeded`. */
  gildCopies?: number;
  /** LOBBY MODE: the 8-seat elimination lobby this run is a seat in (the player is always `seats[0]`).
   *  Serializable by construction — opponent DRIVERS are rebuilt from `(kind, seed, heroId)` rather than stored,
   *  because they are closures and `RunState` is deep-cloned every dispatch. Absent for an ordinary run. */
  lobby?: import('./lobby/runLobby').RunLobby;
  /** The lobby round already settled. The end-combat button owns settling now, and resolving one round
   *  twice would charge every seat twice and re-resolve the other pairings. */
  lobbySettledRound?: number;
  spellFirstDoubleEachTurn?: boolean;
  /** Set 2 — Orivax (Spellweave): a MULTIPLIER on the turn's first spell (3 = casts 3 times). Permanent,
   *  run-wide. Separate from `spellFirstDoubleEachTurn` (Spell Thesis's ×2) so the two stack rather than
   *  clobber, and read gated on `spellsThisTurn === 0` so it stays side-effect-free in the UI's cast preview. */
  spellFirstMultEachTurn?: number;
  /** Orivax (Spellweave): the spells-this-turn count when it was PLAYED. Its multiplier applies while the
   *  count is still at this mark, so playing it mid-turn still multiplies your next spell. Reset each turn. */
  spellMultMark?: number;
  spellFirstUsedThisTurn?: boolean;
  /** Set 2 — Living Grimoire: the multiplier its charge applies to the FIRST spell of a turn (2 base, 3 golden).
   *  Absent/0 = discharged. Run-level rather than per-instance because `spellCasts` — which the UI also calls to
   *  PREVIEW a cast count — reads run state only. Spending it and re-arming it (3 Shouts) both live on the
   *  Grimoire's own hooks; `spellCasts` additionally requires a live Grimoire on board, so selling the source
   *  can't leave a free permanent charge behind. */
  grimoireMult?: number;
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
  /** Bottomless Cellar / Rune of the Bottomless Cask: extra times your Dwarven ALES cast, run-wide. Stacks
   *  ADDITIVELY with Edward Keg-hands, who is a board presence rather than a run flag. */
  aleExtraCasts?: number;
  /** The Golden Ledger: every `per` Gold spent, your `tribe` gains +attack/+health. `tick` banks the remainder
   *  across turns, so a 4-Gold buy followed by a 1-Gold buy pays out exactly once. */
  questGoldTribeBuff?: { tribe: Tribe; per: number; attack: number; health: number; tick: number };
  /** War Council: the tribe whose Rallies and Slaughters trigger an extra time. */
  questTribeRallySlaughter?: Tribe;
  /** Recurrences with a TURN LIMIT (Rune of Quick Study: 2 turns). Kept beside the unlimited list rather
   *  than folded into it: every other recurrence is unbounded, and giving them all a counter would mean
   *  touching every read. Each entry ticks down at End of Turn and drops out at 0. */
  questRecurringLimited?: { effect: NonNullable<RunState['questRecurringEndOfTurn']>[number]; turnsLeft: number }[];
  questRecurringEndOfTurn?: ('triggerLeftmostShout' | 'grantRandomShout' | 'grantRandomAttachments' | 'buffMechsPerAttachment' | 'runeSpending' | 'runeAction' | 'triggerLeftmostEcho' | 'weldMoneyBotsEdgeMechs' | 'undeadPlayedAtk' | 'attachClingDrones' | 'recastFirstSpell' | 'grantAles' | 'grantAles3' | 'quickStudy' | 'copyFirstSpell' | 'grantRuby' | 'grantRuby2' | 'demonEatsRightmostShop' | 'grantFacetwright' | 'lassoing' | 'runeLapidary' | 'runeCrucibleChoir')[];
  /** Bane's Existence: when set, your Banes' after-Battlecry Fodder/Imp buff ALSO grants all your Demons this
   *  much run-wide (a persistent tribe aura). Absent = Bane only buffs Fodder/Imps as printed. */
  baneBuffsDemons?: { attack: number; health: number };
  /** A pending Discover offer (3 card ids) — pick one to hand. */
  discover?: string[];
  /** Disco Dan's Setlist: the shop tier the CURRENTLY-open Discover's pick will be locked until (its
   *  `lockedUntilTier`). Set by `openDiscover` from the spec's `lockTier`, read + cleared when the pick
   *  resolves. Undefined for every normal Discover. */
  discoverLockTier?: number;
  /** The OPEN Discover hands its pick over GILDED (a golden Salvatore McKlusky). Set by `openDiscover` from
   *  the spec and consumed when the pick is taken — exactly the `discoverLockTier` lifecycle, so a queued
   *  mix of gilded and normal Discovers can't leak into each other. */
  discoverGolden?: boolean;
  /** The OPEN Discover hands its pick over locked until this much Gold has been spent this RUN (Brackus).
   *  Mirrors `discoverLockTier`'s lifecycle: set by `openDiscover` from the spec, consumed on take. */
  discoverLockGold?: number;
  /** Hourglass Reserve: the OPEN Discover hands its pick over locked until this WAVE. Mirrors `discoverLockTier`'s
   *  lifecycle: set by `openDiscover` from the spec, stamped onto the taken card, consumed on take. */
  discoverLockWave?: number;
  /** Funeral on Loan: the OPEN Discover hands its pick over BORROWED (play → trigger Echo + destroy). */
  discoverBorrowed?: boolean;
  /** Rune of the Second Path: the queued Discover's pick has its stats OVERWRITTEN to this line (20/20). */
  discoverSetStats?: { attack: number; health: number };
  /** Albus (Empowerment): the OPEN Discover REPLACES this Shop offer instead of granting to hand — the chosen
   *  card is what the targeted offer "turns into". Same one-shot lifecycle as `discoverLockTier`: set when the
   *  power opens the Discover, consumed by `takeDiscoverPick`, cleared with its siblings in the `discover` case.
   *  If the offer is gone by the time the pick lands (bought or rerolled behind a queued Discover), the pick
   *  falls back to the hand rather than vanishing. */
  discoverIntoShopUid?: string;
  /** Rune of the Summit: armed on purchase; `runeSummitTick` counts shops opened since, and every 2nd one
   *  opens a Tier 7 Discover. A COUNTER rather than a per-turn flag because the cadence is every-other-turn
   *  — `recurringEndOfTurn` fires every turn and could not express it. */
  /** How many COPIES of each rune-granted combat flag this run holds (Rune of Duplication). Absent/1 = a
   *  single copy. Threaded into combat via `questCombatMods.flagCopies` so a duplicated BOOLEAN rune fires
   *  its effect twice — amount-carrying flags instead accumulate their amount. See the `combatFlag` case. */
  flagCopies?: Record<string, number>;
  /** Veinstorm's banked grant: the Ruby stats every FUTURE tavern minion is stamped with when it is minted
   *  (owner 2026-08-06: "veinstorm is still a buff to every shop minion — every time i refresh the shop, it
   *  should have that buff"). Deliberately NOT an aura folded at read time: each offer gets a REAL per-offer
   *  `Ruby` buff at mint, so Ruby Transfer can steal it and nothing has to be un-double-counted anywhere. */
  veinstormRubies?: { atk: number; hp: number };
  runeSummit?: boolean;
  /** Rune of Contraband: first Ruby cast each turn → a random Ale; first Ale cast each turn → a Ruby. */
  runeContraband?: boolean;
  contrabandRubyUsed?: boolean;
  contrabandAleUsed?: boolean;
  /** Rune of Cadence: buying a minion arms a 1-Gold discount on the next Shop spell, and casting a Shop
   *  spell arms one on the next minion. The armed flags persist until spent (not turn-scoped). */
  runeCadence?: boolean;
  /** Armed as a NUMBER since the 2026-08-27 duplicate rulings (Gold off = copies held); `true` = 1 in older saves. */
  cadenceSpellOff?: number | boolean;
  cadenceMinionOff?: number | boolean;
  /** Rune of Gemscript: first Shop spell each turn → Ruby power +1/+1; first Ruby each turn → spell power +1/+1. */
  runeGemscript?: boolean;
  gemscriptSpellUsed?: boolean;
  gemscriptRubyUsed?: boolean;
  /** Decoy Sigil casts banked for the NEXT combat (each = one Training Dummy slot-filler). */
  pendingDecoys?: number;
  /** Weaken casts banked for the NEXT combat (each = one random enemy set to 1 Health at SoC). */
  pendingWeaken?: number;
  /** The run's ONE free Runeforge re-roll is spent (owner 2026-07-31: rerolls are free, once per game). */
  runeforgeRerollUsed?: boolean;
  /** Rune of the Matriarch: Runebloom Matriarch's per-spell trigger fires twice. */
  runeMatriarch?: boolean;
  /** Rune of Slaying: kills banked toward the next every-6th dominant-type minion payout. */
  runeSlayingKills?: number;

  // ── Hero tallies (owner batch 2026-08-23). All three are RUN-LIFETIME totals accumulated at settle from
  // counts combat already produces, so no new combat counter exists for any of them. They are kept even while
  // the hero is not wielding the power: a Mimic/Void/Power Shifter run can adopt one of these powers mid-run,
  // and a tally that only started counting on adoption would print a number the player never earned — and,
  // worse, reset if they adopted a different power for a turn.
  /** Aevor (Tempest): enemies your minions have killed this run (`playerQuestTally.slaughter`, summed). Every
   *  15 raises the End-of-Turn grant by another +4/+4; below 15 the power does nothing at all. */
  tempestKills?: number;
  /** Gorun (Blade Mastery): friendly attacks made this run (`playerQuestTally.attack`, summed). Every 8 raises
   *  the per-attack Attack grant by another +3. Threaded INTO combat as the starting offset so the grant can
   *  step up mid-fight, then carried back. */
  bladeAttacks?: number;
  /** Cindara (Hoard): the banked improvement on her Whelps, above the 1/1 base. Each Avenge (4) adds +2/+2 and
   *  applies it RETROACTIVELY to every Whelp she already has out (owner ruling 2026-08-23), so two living
   *  Whelps are always the same size. Persists between combats — that is what makes it a hoard. */
  hoardWhelpBuff?: { attack: number; health: number };
  runeSummitTick?: number;

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
  chooseOne?: {
    uid: string; cardId: string; spell?: boolean; targetUid?: string;
    /** The warband slot the card was dropped into, captured at play time and replayed into the completing
     *  `play` once the branch is picked. Minion Choose Ones only — a spell takes no slot. */
    toIndex?: number;
  };
  /** TRANSIENT, single-dispatch scratch (never meaningful across actions, and nothing persists it): the branch
   *  the player just picked for `uid`, handed to the `play` case as it REPLAYS the deferred play. See the
   *  Choose One deferral in `reducer.ts` — a Choose One card commits nothing when you play it, so the pick is
   *  applied by re-running `play` from the top, which is what keeps every consequence (cards-played meter,
   *  summon buffs, Refrain's RNG roll, triples, the golden Discover) firing exactly once and in the same
   *  order it always did. */
  chooseOnePick?: { uid: string; index: number; targetUid?: string };
  /** A played minion with a *targeted* Battlecry (`CardDef.target === 'friendly'`, e.g. Toxin Tender),
   *  on the board and waiting for the player to pick the friendly minion its Battlecry hits. Resolved
   *  by `battlecryTarget`; auto-resolves on the carry if the turn ends first. `optionIndex` marks a deferred
   *  *targeted Choose One* (Runic Beetle) — the chosen option's effects resolve on the picked target. */
  pendingTarget?: { uid: string; cardId: string; optionIndex?: number;
    /** Common Ground: this pending aim belongs to a SPELL in HAND (not a board battlecry) whose FIRST target
     *  is already picked (`spellFirstUid`); the aim picker chooses the SECOND friendly minion, then the two are
     *  averaged and the spell (`uid` = its hand uid) is consumed. */
    spell?: boolean; spellFirstUid?: string;
    /** CHOOSE ONE, target step (owner ruling 2026-08-28: choose first, THEN target). The card has NOT been
     *  played yet — it is still in hand, nothing has resolved, and the play completes (spell cast / minion
     *  summoned + Battlecry) only once the target is picked. That is what makes a click-away cancel here a
     *  pure no-op instead of stranding a chosen-but-unplaced card. */
    deferredPlay?: boolean;
    /** The warband slot captured at play time, replayed into the completing `play` (minions only). */
    toIndex?: number };
  /** The most recent combat's result, for the UI to replay. Transient. */
  lastCombat?: CombatResult;
  /** OPPONENT PINNING: the exact board fought each wave, keyed by wave number — the full served
   *  `BoardSnapshot`, or `null` when the procedural threat was used (no pool match). The opponent pick is
   *  already deterministic from `(seed, wave)` GIVEN the pool, so within a session/frozen pool a replay
   *  reproduces the same board; this pins the *identity* so a later rebuild stays faithful even if the shared
   *  pool changed (boards uploaded/pruned) — the groundwork server-side replay validation needs. Recorded at
   *  serve time; when a wave is already present here (a restored/replayed run), the reducer serves the pinned
   *  board instead of re-picking. Key presence = "decided"; absent = pick fresh. */
  servedBoards?: Record<number, BoardSnapshot | null>;
}

/** One Equipment the player currently holds, and which board bodies are granting it. */
export interface GrantedEquipment {
  equipmentId: string;
  /** Which wording/params apply. A single Gilded source anywhere upgrades the whole entry (handoff rule). */
  version: 'plain' | 'gilded';
  /** EVERY source, tracked independently — duplicates collapse to one selector entry but each still gets its
   *  own re-equip beat, and source VALIDITY (has it survived?) is per-source. */
  sourceUids: string[];
  /** The wave it was granted on — diagnostic, and the tell for "granted this turn" vs "re-equipped". */
  grantedTurn: number;
}

/**
 * The player's Equipment for THIS turn. Uses are a shared player-level allowance, not a per-Equipment lock:
 * activating any Equipment spends one, and swapping spends nothing.
 */
export interface PlayerEquipmentState {
  available: GrantedEquipment[];
  /** What the slot is showing. Swapping changes only this. */
  selectedEquipmentId?: string;
  /** The last SUCCESSFULLY ACTIVATED Equipment (not merely viewed) — the rebuild restores it when its source
   *  survives. Deliberately survives the rebuild that clears `available`. */
  lastUsedEquipmentId?: string;
  /** Normally 1. Reset every Start of Turn. */
  baseActivations: number;
  /** Granted on top of the baseline, this turn only. */
  bonusActivations: number;
  activationsSpent: number;
  /** Gold off the next activation. Additive, floored at 0 by `equipmentCostOf`, expires at End of Turn. */
  temporaryCostReduction: number;
}

export type Action =
  /** Combat replay: an escalating spell improved itself mid-fight — bump the display-only preview. */
  | { type: 'combatEscalationPreview'; attack: number; health: number }
  /** Combat replay: a Shop Spell resolved mid-fight — bump the display-only spells-cast preview. */
  | { type: 'combatSpellCastPreview' }
  | { type: 'combatFriendlyDeathPreview' }
  | { type: 'combatBladeAttackPreview' }
  | { type: 'buy'; uid: string }
  /** Recruit your hero's HENCHMAN for its current (decayed) cost — once per run. See `henchmanCostOf`. */
  | { type: 'buyHenchman' }
  | { type: 'play'; uid: string; toIndex?: number; targetUid?: string }
  | { type: 'sell'; uid: string }
  | { type: 'roll' }
  | { type: 'freeze' }
  | { type: 'upgrade' }
  | { type: 'reposition'; uid: string; toIndex: number }
  | { type: 'reorderShop'; uid: string; toIndex: number }
  | { type: 'reorderHand'; uid: string; toIndex: number }
  | { type: 'heroPower'; uid?: string; commission?: CommissionKind; flashPick?: 'first' | 'last'; slot?: number } // uid omitted for untargeted powers (Nadja's Mana Font); `commission` carries Cassen's chosen option; `slot` picks WHICH wielded power fires (Void holds two — 0 = the main button, 1 = the second)
  | { type: 'pickPower'; index: number } // power Discover (Mimic every turn / Void turn 4): adopt the offered hero's power
  | { type: 'discover'; index: number }
  | { type: 'buyQuest'; index: number } // quest shop (waves 4/8/12): "buy" the offered quest at `index` for 0 Gold
  | { type: 'buyRune'; index: number } // Runeforge (turn 6): buy the offered rune at `index` for its Gold cost
  | { type: 'skipRuneforge' } // Runeforge: leave without buying (closes the forge)
  | { type: 'rerollRuneforge' } // Runeforge: re-roll the offered runes once, for 2 Gold
  | { type: 'chooseOne'; index: number }
  /** Click away from a Choose One (the option prompt OR its target step) — the card returns to hand exactly
   *  as it was: no effects, no Gold moved, no triggers fired, no RNG drawn. It is a real ACTION rather than a
   *  UI-only dismiss so a recording replays the abandoned play the same way the player lived it. Only ever
   *  cancels a DEFERRED Choose One; an ordinary battlecry aim (Toxin Tender, already on the board) is
   *  untouched by it. */
  | { type: 'cancelChoice' }
  | { type: 'battlecryTarget'; targetUid: string }
  /** Resolve the body that landed and is now dying (`pendingDeath`) — its Echo, its departure, its Rise. The
   *  UI dispatches this after the landing has been on screen long enough to read. It is a real ACTION, not a
   *  UI-only tick, so a recording replays the two steps the way the player lived them; and because every other
   *  action resolves the same pending death first, dispatching it late (or never) cannot change the outcome. */
  | { type: 'resolveShopDeath' }
  /** Swap which Equipment the second slot shows. Free: no Gold, no activation, no exhaustion change. */
  | { type: 'selectEquipment'; equipmentId: string }
  /** Activate the SELECTED Equipment. ATOMIC (owner ruling 2026-08-28) — validate, pay, spend one shared
   *  allowance and resolve every trigger in one action, exactly as every hero power does. `targetUid` is
   *  required for a targeting Equipment; cancelling never dispatches this at all. */
  | { type: 'activateEquipment'; targetUid?: string }
  | { type: 'closeScout' } // Farseer's Report: dismiss the scout reveal
  | { type: 'faceOmen' }
  | { type: 'settleCombat' }
  | { type: 'resolveCombat' }
  /** DEV Scene Builder only — drop a quest (optionally already completed) or a rune straight into the run so
   *  its interactions can be tested without playing to the turn that offers it. Routed through the SAME
   *  reward engine a real buy/completion uses; see the reducer case. */
  | { type: 'devGrant'; kind: 'quest' | 'rune'; id: string; completed?: boolean };

/** The automatic combat-flow transitions — they fire ~once per round regardless of how the player
 *  builds, so they're excluded from the "actions per round" stat (which measures player decisions). */
const COMBAT_FLOW_ACTIONS = new Set<Action['type']>(['faceOmen', 'settleCombat', 'resolveCombat']);
/** Is this a player-initiated decision (buy / sell / play / roll / freeze / tier-up / reposition /
 *  discover / choose / hero power / targeting) vs. an automatic combat-flow transition? Basis for APT. */
export const isPlayerAction = (a: Action): boolean => !COMBAT_FLOW_ACTIONS.has(a.type);

/** A run's W–L record over the SCORED rounds only (A1). The first `CONFIG.calibrationRounds` rounds are
 *  calibration and don't count; draws are excluded from both wins and losses. `history[i]` is round i+1's
 *  result, so scored results = `history.slice(calibrationRounds)`. */
/** The hero's henchman offer for this run, priced with the accrued win/loss decay — or null when the hero has
 *  no henchman authored yet (most heroes today) or it was already recruited (once per run). */
export function henchmanOffer(state: RunState): { cardId: string; cost: number } | null {
  // ── THE ARCHIVE GATE (owner ruling 2026-08-28: "henchmen are not in the game and are extremely WIP /
  // being removed for now") ────────────────────────────────────────────────────────────────────────────
  // The single producer of a henchman offer. `buyHenchman` (reducer.ts) refuses without one and the
  // StatusBar chip renders only when this is non-null, so this line takes the whole system out of play
  // while `HENCHMEN` and every hero's `henchman` link stay resolvable. See `HENCHMEN_ARCHIVED` (config.ts).
  if (HENCHMEN_ARCHIVED) return null;
  const h = getHero(state.heroId).henchman;
  if (!h || state.henchmanBought) return null;
  return { cardId: h.cardId, cost: Math.max(0, h.cost - (state.henchmanDiscount ?? 0)) };
}

/**
 * The hand's capacity RIGHT NOW.
 *
 * Normally `CONFIG.handMax` (10). While the RUNEFORGE IS OPEN it rises to `CONFIG.handMaxRuneTurn` (20), so a
 * rune's rewards can all land even on a full hand (owner ruling 2026-08-04: "at the start of rune turns the
 * player should be allowed to have up to 20 cards only one time — if they have a full hand and choose Edward
 * Keg Hands, they should get the Ales and Edward").
 *
 * Keyed on the forge being OPEN rather than on a flag with its own lifecycle, which is what makes it
 * naturally once-per-rune-turn: `buyRune` applies the reward (and Rune of Duplication's second application)
 * while the offer is still set, and only then calls `closeRuneforge`. Nothing has to remember to clear it,
 * and the raised cap cannot leak into an ordinary shop turn.
 *
 * The extra cards are KEPT afterwards — the normal cap only governs ADDING, so nothing is discarded when the
 * forge closes; you simply can't grow past 10 again until you play down.
 */
export function handCap(state: Pick<RunState, 'runeforgeOffer'>): number {
  return state.runeforgeOffer ? CONFIG.handMaxRuneTurn : CONFIG.handMax;
}

/**
 * Hand slots RESERVED for Discover picks that are open or queued but not yet chosen.
 *
 * A Discover is a card the player is actively being asked to choose; a passive grant that fills the last
 * slot in the meantime silently destroys that choice. Owner ruling 2026-08-04: "Spell Warden's duplicated
 * spell should have lower priority than a card discovered — if the player has a golden Spell Warden and 10
 * cards in hand and their 2nd spell is a Discover, the discovered card takes precedence."
 *
 * Counts the OPEN prompt plus everything still queued behind it, so a chain of Discovers each keeps a slot.
 */
export function reservedHandSlots(state: Pick<RunState, 'discover' | 'discoverQueue'>): number {
  return (state.discover ? 1 : 0) + (state.discoverQueue?.length ?? 0);
}

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
/**
 * `setId` overrides which card SET the run is pinned to. It defaults to the live registry (`activeSet()`),
 * which is what every real run uses — the override exists so the DEV Scene Builder can play an unreleased,
 * `enabled: false` set (set 2 in development) WITHOUT flipping the global switch and moving real players onto
 * it. Pinned exactly like the default: once set here, everything downstream reads `RunState.setId` through
 * `poolOf(state)`, so a sandbox set-2 run never touches set 1's pool or seeds.
 */
export function createRun(seed: number, heroId: string = DEFAULT_HERO_ID, mode: RunMode = 'ascent', line: number = CONFIG.defaultLine, setId: SetId = activeSet().id): RunState {
  // Draw the run's active tribes from the PINNED set's roster (set 1's five, set 2's Kobolds) — never the
  // global list, so a set-2 tribe can't leak into a set-1 run and vice-versa.
  const tribes = selectRunTribes(makeRng(mixSeed(seed, 0, TAG.TRIBES)), SETS[setId]?.tribes ?? PLAYABLE_TRIBES);
  // The hero's Resolve is the run's starting (and max) HP; Armor is extra effective HP layered on top.
  const hero = getHero(heroId);
  const startResolve = hero.resolve;
  // Pin the rift ONCE and derive from that same value, so the Armor bonus and `state.rift` can never
  // disagree (calling activeRift() twice would also read the registry twice).
  // Rifts are OPT-IN as of the mode picker: only a RIFT run adopts the active rift, so a plain Ascent
  // (or Practice) climb is unmodified. Still pinned at creation, so a saved/replayed rift run keeps its
  // rules after the global switch flips off.
  const pinnedRift = mode === 'rift' ? (activeRift()?.id ?? null) : null;
  const riftArmor = RIFT_BONUS_ARMOR[pinnedRift as RiftId] ?? 0; // Summit: +10 to every hero
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
    armor: hero.armor + riftArmor,
    maxArmor: hero.armor + riftArmor,
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
    keshiTierPoints: 0,
    turnStartPower: 0,
    servedBoards: {},
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
    pool: stockPool(tribes, poolFor(setId).buyable),
    uidSeq: 0,
    pendingTavern: [],
    cardBuffs: {},
    fodderEatenSeq: 0,
    shopEatenSeq: 0,
    recruitBuffFx: [],
    recruitFxSeq: 0,
    aleGranted: [],
    aleGrantSeq: 0,
    karwindFlashSeq: 0,
    rift: pinnedRift, // pin the live rift so replays keep it after the switch flips off
    setId, // …and the card set (defaults to the live one) — for the same reason (see RunState.setId)
  };
  rollShop(state);
  // Croupier Ayse: the OPENING shop rolls for Enchanted marks like every later one (owner change 2026-08-22).
  // `createRun` fills the first shop directly rather than through the reducer's `refreshTavern`, so before
  // this the very first shop was guaranteed plain — the one fill her power could never touch.
  rollCiaEnchants(state);
  // Guardian (Runeguard): schedule the Epic Runeforge for turn 8 — advanceCombat's start-of-turn
  // sequencing opens it (behind any quest offer). Cleared once it fires.
  if (hero.power.kind === 'epicRuneforge') state.epicForgeWave = 8; // hero forge, one turn ahead of the system's 9
  // Croupier Ayse (Lucky Seat): queue the OPENING suit so her power button has art from turn 1 and the player
  // can see what the first payout will be. Seeded off the run's own cursor like every other pick.
  if (hero.power.kind === 'luckySeat') {
    const rng = makeRng(state.rngCursor);
    state.ciaSuit = (['hearts', 'spades', 'diamonds', 'clubs'] as const)[rng.int(4)];
    state.rngCursor = rng.state();
  }
  // Yirin (Reflector): the run opens holding one. Keyed off the POWER KIND rather than the hero id — Yirin's
  // id is `rohan` (stable for saves), so an id check here would read as a bug to the next person.
  if (hero.power.kind === 'startingReflector') {
    const def = CARD_INDEX['n2_reflector'];
    if (def && state.hand.length < handCap(state)) {
      state.hand.push({
        uid: `b${state.uidSeq++}`,
        cardId: def.id,
        tribe: def.tribe,
        attack: def.attack,
        health: def.health,
        keywords: [...def.keywords],
        golden: false,
      });
    }
  }
  if (heroId === 'chaos') {
    const def = CARD_INDEX['symbioticattachment'];
    if (def && state.hand.length < handCap(state)) {
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
  // Fi & Coran (heroQuest): the run OPENS on their two-option quest Discover. It has to be minted here rather
  // than in `advanceCombat`'s turn setup — turn 1 never passes through a turn advance, so the wave-1 branch of
  // `questOfferPlan` would otherwise never be reached. The offer sits in `questOffer` exactly like a turn-5
  // one, so it inherits the modal guard, the picker UI and `buyQuest` with no new plumbing.
  // MIMIC: "at the start of EVERY turn" includes turn 1, and turn 1 never passes through a turn advance —
  // the same lesson Fi/Coran's quest Discover learned — so the first power offer is minted here.
  if (hero.power.kind === 'mimic' && state.mode !== 'tutorial') {
    const rng = makeRng(state.rngCursor);
    const pool = powerDiscoverPool('mimic');
    const heroIds: string[] = [];
    while (heroIds.length < 2 && pool.length > 0) heroIds.push(pool.splice(rng.int(pool.length), 1)[0]!);
    state.rngCursor = rng.state();
    if (heroIds.length > 0) state.powerOffer = { heroIds, slot: 'mimic' };
  }
  if (hero.power.kind === 'heroQuest' && state.mode !== 'tutorial') {
    const plan = questOfferPlan(state);
    const offer = plan ? generateQuestOffer(state, plan) : [];
    if (offer.length > 0) state.questOffer = offer;
  }
  // Disco Dan's Setlist: turn 1 opens three sequential Discovers — Tier 6 first, then Tier 4, then Tier 2 —
  // each pick locked in hand until you reach that shop tier. queueDiscover opens the first and stacks the
  // rest behind it (drained one at a time as each resolves).
  if (heroId === 'discodan') {
    for (const tier of [6, 4, 2]) {
      queueDiscover(state, { kind: 'minion', tier, exactTier: tier, lockTier: tier });
    }
  }
  // Brackus's Summit: one Tier 7 Discover at run start, locked in hand until 70 Gold has been spent this
  // run. `exactTier: 7` is a FIXED-tier Discover, so it is honoured with no rift active — that back door is
  // the whole point of the card (Tier 7 is otherwise unreachable outside a rift).
  if (heroId === 'brackus') {
    queueDiscover(state, { kind: 'minion', tier: 7, exactTier: 7, lockGold: 70 });
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
  // The SET is healed to `set1`, NOT to the fresh-run default — `createRun` pins whatever set is live right
  // now, so the `{...defaults, ...parsed}` merge would silently re-home a pre-sets save onto set 2 the day
  // set 2 goes live, and every subsequent shop roll would draw from a pool that run never played. Any save
  // written before sets existed was played on set 1, by definition.
  state.setId = parsed.setId ?? 'set1';
  // pre-pool saves: stock for the run's own tribes, from the set the run is pinned to (not the live one)
  if (!parsed.pool) state.pool = stockPool(state.tribes, poolFor(state.setId ?? 'set1').buyable);
  // createRun seeds hero run-START Discovers into the defaults skeleton (Disco Dan's Setlist opens a Tier 6
  // Discover + queues Tier 4 / Tier 2 behind it). Those are a fresh-run ACTION, not a field default — but
  // JSON.stringify drops `undefined`, so a save that already resolved them omits the `discover` /
  // `discoverLockTier` keys and the `{...defaults, ...parsed}` merge leaks the fresh Tier 6 offer straight back
  // in — re-Discovering on every reload (owner bug 2026-07-13). Force the SAVED values (absent → cleared), so a
  // resumed run keeps exactly the Discover state it was saved with. (The pendingSpellDiscovers heal below then
  // re-appends to whatever queue the save actually had.)
  state.discover = parsed.discover;
  state.discoverLockTier = parsed.discoverLockTier;
  state.discoverQueue = parsed.discoverQueue;
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

/**
 * Card ids a saved run references that this build no longer has — non-empty means the save is unplayable
 * and Continue should be refused rather than crashing on the first `CARD_INDEX[id]` deref.
 *
 * `deserialize` deliberately does NOT throw: healing a save is best-effort and a partially-broken save is
 * still worth inspecting. The caller decides. This exists because a set whose cards get deleted (or a save
 * carried between branches mid-development) would otherwise surface as an undefined-property crash in the
 * HUD, with nothing pointing at the real cause.
 */
export function missingCardIds(state: RunState): string[] {
  const ids = new Set<string>();
  for (const c of [...state.board, ...state.hand, ...state.shop]) {
    if (!CARD_INDEX[c.cardId]) ids.add(c.cardId);
  }
  if (state.spell && !CARD_INDEX[state.spell.cardId]) ids.add(state.spell.cardId);
  return [...ids];
}
