// GENERATED from packages/progression/src/achievements.ts by `npm run progression:shared`. DO NOT EDIT.
// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.
// Deno module (the submit-progression Edge Function imports it); the repo's tsc/eslint skip supabase/**.
/**
 * ACHIEVEMENTS, batch 1: the definitions registry and the evaluator (owner 2026-09-28).
 *
 * Owner direction 2026-09-28: "we'll need an achievements tab in career next to practice. most should show, with
 * their reward, but the hidden ones will be blurred or say "Hidden" and we'll come up with fun rewards for them.
 * let's just get the normal xp related achievements in for now though." Earlier: "we need set 2 achievements
 * because that is the active set right now."
 *
 * So batch 1 ships ONLY achievements whose reward is XP: the set-agnostic Career / Ranked / Hero / Economy and Build
 * / Mechanics / Runes families and the Set 2 tribe feats. Titles are out for now (every def carries
 * `rewards.titleId: null`, the slot a title fills later with no migration). The framework supports `hidden: true`
 * (the Career tab blurs it as "Hidden"). The first hidden ones are the SECRET TITLES (owner 2026-11-20, `SECRET_ACHIEVEMENTS`).
 *
 * THE MODEL. Every achievement reads ONE metric from the settlement and compares it with a target:
 *   - `agg: 'max'`: progress = max(progress, this game's value). A one-game feat ("8 Rubies in one turn") or an
 *     account state (highest division, distinct heroes played).
 *   - `agg: 'sum'`: progress += this game's value. A lifetime family ("Complete 50 games", "Play 500 Rubies").
 *   Complete when progress >= target. A completed achievement never progresses or pays again.
 * A game only contributes when it passes the def's gates: mode (`any` = Ranked + a standard Practice with Normal
 * Health and a turn timer; `ranked`; `tutorial`; `account` = every settlement), set (Set 2 feats need a Set 2 run),
 * hero, and placement (1st, or Top 4).
 *
 * WHERE THE METRICS COME FROM. RUN metrics are counted by the run observer (packages/sim runDerive.ts) and ride in
 * the facts document (`ProgressionRunFactsV2.metrics`); ordinary trust, replay kept for audit. SERVER metrics are
 * computed by `settle_progression` from its own rows (the game itself, the accepted comeback, the rank result, the
 * Career best, distinct heroes, completions so far). The SQL evaluates the catalog inside the settlement
 * transaction; `evaluateAchievements` below is its exact TS mirror (parity-tested against the SQL in PGlite).
 *
 * CODE IS THE SOURCE OF TRUTH. The `submit-progression` Edge Function pushes `achievementCatalogPayload()` into
 * `achievement_catalog` once per cold start (`sync_achievement_catalog`, hash-short-circuited). A def REMOVED from
 * this file is marked inactive, never deleted (completions reference it). Ids are permanent.
 *
 * DEPENDENCY-FREE (its only imports are sibling types): generated verbatim into
 * supabase/functions/_shared/progressionAchievements.ts by `npm run progression:shared`.
 */
import type { ProgressionMode } from './progressionRules.ts';
import { FIRSTS_100_TITLE_ID, PLUSHIE_BEASTS_COLLECTION_ID, PLUSHIE_PLATE_ID, SECRET_TITLE_NAMES, collectionMembers, heroMasterTitleId, heroTitleId, secretAchievementId, secretTitleId } from './progressionCosmetics.ts';

// ── Metrics ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every RUN metric the observer counts, with the sanity cap the server clamps to (a value over the cap is
 * dropped, not trusted). Keys are permanent: they are stored in facts documents and in `achievement_catalog`.
 * "Turn" = one Shop phase (a wave); "combat" = one fight; "game" = the whole run.
 */
export const RUN_METRICS = {
  // economy and shop
  goldSpentTurnMax: { cap: 10_000, doc: 'Most Gold spent in one turn.' },
  goldSpent: { cap: 100_000, doc: 'Gold spent this game.' },
  refreshesTurnMax: { cap: 10_000, doc: 'Most Shop refreshes in one turn.' },
  sellsTurnMax: { cap: 1_000, doc: 'Most minions sold in one turn.' },
  buysTurnMax: { cap: 1_000, doc: 'Most cards bought in one turn.' },
  playsTurnMax: { cap: 1_000, doc: 'Most cards played from hand in one turn.' },
  tierSixByRound9: { cap: 1, doc: '1 when Shop Tier 6 was reached by round 9.' },
  frozenBuysTurnMax: { cap: 100, doc: 'Most cards bought in one turn from the Shop frozen the turn before.' },
  gildsMade: { cap: 1_000, doc: 'Minions Gilded this game.' },
  gildedOnBoardMax: { cap: 7, doc: 'Most Gilded minions on the board at once.' },
  boardStatsCombatMax: { cap: 10_000_000, doc: 'Most total Attack plus Health on the board entering a combat.' },
  finalTribes: { cap: 20, doc: 'Different tribes on the final board (printed tribes; Neutral and All-types do not count).' },
  balancedWin: { cap: 1, doc: '1 when a combat was won that began with 5+ minions and no tribe more than twice.' },
  cleanWinLate: { cap: 1, doc: '1 when a combat from round 10 on was won with no friendly minion dying.' },
  underdogWinLate: { cap: 1, doc: '1 when a combat from round 8 on was won starting with 70% or less of the enemy total stats.' },
  // runes
  basicRunesForged: { cap: 100, doc: 'Basic Runes forged this game.' },
  epicRunesForged: { cap: 100, doc: 'Epic Runes forged this game.' },
  runeTriggers: { cap: 100_000, doc: 'Rune payouts this game (every rune, summed).' },
  runesFivePlus: { cap: 100, doc: 'Different Runes that paid out 5+ times this game.' },
  menagerieRuneFinalTribes: { cap: 20, doc: 'Final-board tribes when holding Menagerie (0 without it).' },
  // mechanics
  shoutsTurnMax: { cap: 10_000, doc: 'Most Shout triggers in one turn.' },
  eotFiresMax: { cap: 10_000, doc: 'Most End of Turn triggers in one End of Turn.' },
  echoesCombatMax: { cap: 10_000, doc: 'Most friendly Echoes in one combat.' },
  wardBlocksCombatMax: { cap: 10_000, doc: 'Most hits a friendly Ward absorbed in one combat.' },
  summonsCombatMax: { cap: 10_000, doc: 'Most friendly summons in one combat.' },
  // Set 2: Kobolds
  rubyPlaysTurnMax: { cap: 10_000, doc: 'Most Rubies played in one turn.' },
  rubyPlays: { cap: 100_000, doc: 'Rubies played this game.' },
  rubyStrength: { cap: 100_000, doc: 'Highest Ruby bonus reached (the lower of its Attack and Health).' },
  rubyFacetsOnKobolds: { cap: 5, doc: 'Different special Rubies played on a Kobold this game.' },
  rubiesLandedCombatMax: { cap: 100_000, doc: 'Most Rubies landing on friendly minions in one combat.' },
  golemStatsCombatMax: { cap: 10_000_000, doc: 'Largest Gemheart Golem summoned in combat (Attack plus Health).' },
  finalKobolds: { cap: 7, doc: 'Kobolds on the final board.' },
  // Set 2: Dwarves
  alesTurnMax: { cap: 10_000, doc: 'Most Dwarven Ales cast in one turn.' },
  alesCast: { cap: 100_000, doc: 'Dwarven Ales cast this game.' },
  aleKinds: { cap: 5, doc: 'Different Dwarven Ales played this game.' },
  dwarfPayrollTurnMax: { cap: 10_000, doc: 'Most Gold spent in one turn while 2+ Dwarves were on the board.' },
  finalDwarves: { cap: 7, doc: 'Dwarves on the final board.' },
  // Set 2: Dragons
  spellsTurnMax: { cap: 10_000, doc: 'Most Shop spells cast in one turn.' },
  spellsCast: { cap: 100_000, doc: 'Shop spells cast this game.' },
  spellPower: { cap: 100_000, doc: 'Highest spell power reached (the higher of its Attack and Health).' },
  dragonShoutsTurnMax: { cap: 10_000, doc: 'Most Shout triggers in one turn while 3+ Dragons were on the board.' },
  dragonflameMax: { cap: 10_000_000, doc: 'Largest single Dragonflame buff in combat (the lower of its Attack and Health).' },
  finalDragons: { cap: 7, doc: 'Dragons on the final board.' },
  // Set 2: Beasts
  beastEchoesCombatMax: { cap: 10_000, doc: 'Most friendly Beast Echoes in one combat.' },
  beastSummonsCombatMax: { cap: 10_000, doc: 'Most friendly Beasts summoned in one combat.' },
  oonaBeastSummonMax: { cap: 10_000_000, doc: 'Largest Beast summoned in a combat King Oona entered (Attack plus Health).' },
  executeKillsCombatMax: { cap: 10_000, doc: 'Most enemy minions destroyed by Execute in one combat.' },
  finalCombatEchoes: { cap: 10_000, doc: 'Friendly Echoes in the last combat of the game.' },
  finalBeasts: { cap: 7, doc: 'Beasts on the final board.' },
  // Set 2: Demons
  consumesTurnMax: { cap: 1_000, doc: 'Most Shop minions consumed in one turn.' },
  consumes: { cap: 10_000, doc: 'Shop minions consumed this game.' },
  consumedStatsMax: { cap: 10_000_000, doc: 'Largest Shop minion consumed (Attack plus Health).' },
  impBuff: { cap: 100_000, doc: 'Highest Imp buff reached (the lower of its Attack and Health).' },
  impSummonsCombatMax: { cap: 10_000, doc: 'Most Imps summoned in one combat.' },
  finalDemonStatsMax: { cap: 10_000_000, doc: 'Largest Demon on the final board (Attack plus Health).' },
  finalDemons: { cap: 7, doc: 'Demons on the final board.' },
  // Set 2: cross-tribe
  mountainbond: { cap: 1, doc: '1 when one turn had 20+ Gold spent and 8+ Rubies played with a Dwarf and a Kobold on the board.' },
  darkRubyConsumes: { cap: 1_000, doc: 'Shop minions consumed by Dark Rubies this game.' },
  liquidCourage: { cap: 1, doc: '1 when one turn had 10+ Shop spells, 4+ of them Ales, with a Dragon and a Dwarf on the board.' },
  arcaneFacetsTurnMax: { cap: 10_000, doc: 'Most Rubies plus Shop spells played in one turn.' },
  feedingFrenzy: { cap: 1, doc: '1 when one combat summoned 6+ Beasts and 3+ Imps.' },
  // Set 2: runes
  epicFitWin: { cap: 1, doc: '1 when an Epic Rune forged for a tribe with 3+ minions on the board was followed by a won combat.' },
  tribalRunePair: { cap: 1, doc: '1 when the game ended holding a Basic and an Epic Rune of the same tribe.' },
  overtimeProcs: { cap: 10_000, doc: 'Overtime payouts this game.' },
  blartProcs: { cap: 10_000, doc: 'Blart payouts this game.' },
  // Achievements 150 (owner 2026-10-03): heroes and combat feats. Same trust as every run metric (O).
  heroPowerUses: { cap: 1_000, doc: 'Hero power uses this game (an accepted heroPower action).' },
  flawlessWins: { cap: 100, doc: 'Combats won this game with no friendly minion dying.' },
  lastStandWins: { cap: 100, doc: 'Combats won this game with exactly 1 friendly minion surviving.' },
  combatWinStreakMax: { cap: 100, doc: 'Most combats won in a row this game (a draw or loss ends the run of wins).' },
  undefeated: { cap: 1, doc: '1 when the game had 5+ combats and lost none.' },
  knockouts: { cap: 7, doc: 'Lobby players knocked out by your own fight this game (they fell in the round you hit them).' },
  heroDamageCombatMax: { cap: 1_000, doc: 'Most damage dealt to an opponent in one fight (the lobby encounter record).' },
  heroDamageDealt: { cap: 100_000, doc: 'Damage dealt to opponents this game (the lobby encounter records, summed).' },
  enemyKillsCombatMax: { cap: 1_000, doc: 'Most enemy minions destroyed in one combat.' },
  enemyKills: { cap: 100_000, doc: 'Enemy minions destroyed this game.' },
  brink: { cap: 1, doc: '1 when your Health fell to 5 or less (and above 0) this game.' },
  // SECRET TITLES (owner 2026-11-20): the run metrics behind the hidden feats (SECRET below). Same trust (O).
  dwarfPlays: { cap: 10_000, doc: 'Dwarf minions played from hand this game.' },
  dragonPlays: { cap: 10_000, doc: 'Dragon minions played from hand this game.' },
  koboldPlays: { cap: 10_000, doc: 'Kobold minions played from hand this game.' },
  impSummons: { cap: 100_000, doc: 'Imps summoned in combat this game.' },
  spiritFullRounds: { cap: 100, doc: 'Different rounds with 7 Spirits on the board at once.' },
  undeadRises: { cap: 100_000, doc: 'Friendly Undead Rises in combat this game.' },
  starformAttackMax: { cap: 10_000_000, doc: 'Highest Attack a Starform reached in the Shop.' },
  finalBeastPack: { cap: 7, doc: 'Different Beasts on the final board when every minion on it is a Beast (0 otherwise).' },
  finalTribesSpread: { cap: 20, doc: 'Final-board tribes when no tribe has more than 2 minions (0 otherwise).' },
  noRefreshGame: { cap: 1, doc: '1 when the game had 5+ combats and no Shop refresh.' },
  goldTurnStartMax: { cap: 10_000, doc: 'Most Gold held at the start of a turn.' },
  lowTierGame: { cap: 1, doc: '1 when the game had 5+ combats and Shop Tier never went past 3.' },
  tierSixByRound6: { cap: 1, doc: '1 when Shop Tier 6 was reached by round 6.' },
  lateTierSix: { cap: 1, doc: '1 when Shop Tier 6 was first reached on round 13 or later.' },
  zeroGoldStreakMax: { cap: 100, doc: 'Most turns in a row ended with exactly 0 Gold.' },
  discountBuys: { cap: 10_000, doc: 'Discounted Shop minions bought this game: paid less than your own standard minion price (a hero whose minions just cost less does not count).' },
  lastStandOneHp: { cap: 1, doc: '1 when a combat was won with 1 friendly minion left, on exactly 1 Health.' },
  comebackOneVsSeven: { cap: 1, doc: '1 when a combat was won after being down to 1 minion against 7.' },
  hitDamageMax: { cap: 10_000_000, doc: 'Most damage one friendly hit dealt to an enemy minion.' },
  glassCannonWin: { cap: 1, doc: '1 when a combat was won that began with 4+ friendly minions, every one at 1 Health.' },
  echoTriggersCombatMax: { cap: 100_000, doc: 'Most friendly Echo triggers in one combat (every Echo multiplier counted).' },
  ralliesCombatMax: { cap: 100_000, doc: 'Most friendly Rally triggers in one combat (every Rally doubler counted).' },
  attacksSurvivedMax: { cap: 10_000, doc: 'Most attacks one friendly minion was hit by and lived through in one combat.' },
  oneHealthRounds: { cap: 100, doc: 'Lobby rounds you ended alive on exactly 1 Health and no Armor.' },
  perfectRecord: { cap: 1, doc: '1 when the game had 5+ combats and every one was won.' },
  fullHealthFinish: { cap: 1, doc: '1 when the game ended with your Health still at its starting value (Armor may be gone).' },
  leaderKnockout: { cap: 1, doc: '1 when your fight knocked out the seat with the most Health plus Armor at the table.' },
  knockoutStreakMax: { cap: 100, doc: 'Most lobby rounds in a row in which your fight knocked out a player.' },
  lastAtRound10: { cap: 1, doc: '1 when you had the least Health plus Armor at the table after round 10.' },
  exactLethalFinish: { cap: 1, doc: '1 when your last fight of the game knocked out its opponent with exactly lethal damage.' },
  combatDraws: { cap: 100, doc: 'Combats tied this game.' },
  minionStatsMinMax: { cap: 10_000_000, doc: 'Largest minion on the board (the lower of its Attack and Health).' },
  buffsOnOneMax: { cap: 100_000, doc: 'Most separate permanent buffs one minion carried.' },
  finalSameCardMax: { cap: 7, doc: 'Most copies of one minion on the final board.' },
  finalTierOneOnly: { cap: 7, doc: 'Minions on the final board when every one is a Tier 1 minion (0 otherwise).' },
  emptyBoardWin: { cap: 1, doc: '1 when a combat was won that began with no friendly minions.' },
  pacifistWin: { cap: 1, doc: '1 when a combat against minions was won with no friendly minion attacking.' },
  fullHandFrom5: { cap: 1, doc: '1 when every turn from round 5 to the end (5+ turns) ended with a full hand.' },
  // SECRET TITLES, tribe batch (owner 2026-11-20: "add 5 more titles per tribe").
  dwarfGildedMax: { cap: 7, doc: 'Most Gilded Dwarves on the board at once.' },
  demonGildedMax: { cap: 7, doc: 'Most Gilded Demons on the board at once.' },
  spiritGildedMax: { cap: 7, doc: 'Most Gilded Spirits on the board at once.' },
  dragonGildedMax: { cap: 7, doc: 'Most Gilded Dragons on the board at once.' },
  beastGildedMax: { cap: 7, doc: 'Most Gilded Beasts on the board at once.' },
  undeadGildedMax: { cap: 7, doc: 'Most Gilded Undead on the board at once.' },
  koboldGildedMax: { cap: 7, doc: 'Most Gilded Kobolds on the board at once.' },
  celestialGildedMax: { cap: 7, doc: 'Most Gilded Celestials on the board at once.' },
  demonAttackMax: { cap: 10_000_000, doc: 'Highest Attack of a Demon on the board.' },
  koboldAttackMax: { cap: 10_000_000, doc: 'Highest Attack of a Kobold on the board.' },
  dragonAttackMax: { cap: 10_000_000, doc: 'Highest Attack of a Dragon on the board.' },
  undeadAttackMax: { cap: 10_000_000, doc: 'Highest Attack of an Undead on the board.' },
  spiritAttackMax: { cap: 10_000_000, doc: 'Highest Attack of a Spirit on the board.' },
  celestialAttackMax: { cap: 10_000_000, doc: 'Highest Attack of a Celestial on the board.' },
  spiritPlays: { cap: 10_000, doc: 'Spirit minions played from hand this game.' },
  celestialPlays: { cap: 10_000, doc: 'Celestial minions played from hand this game.' },
  dwarfHallSpendTurnMax: { cap: 10_000, doc: 'Most Gold spent in one turn while 5+ Dwarves were on the board.' },
  celestialSpellsTurnMax: { cap: 10_000, doc: 'Most Shop spells cast in one turn while 3+ Celestials were on the board.' },
  kobebesMax: { cap: 7, doc: 'Most Kobebes on the board at once.' },
  revelerSells: { cap: 10_000, doc: 'Revelers sold this game.' },
  combatGoldMax: { cap: 10_000, doc: 'Most Gold banked for next turn during one combat (the bonusGold log).' },
  demonDamageCombatMax: { cap: 10_000_000, doc: 'Most damage friendly Demons dealt to enemy minions in one combat.' },
  undeadRisesCombatMax: { cap: 10_000, doc: 'Most friendly Undead Rises in one combat.' },
  skeletonSummonsCombatMax: { cap: 10_000, doc: 'Most Skeletons summoned in one combat.' },
  handSummonsCombatMax: { cap: 10_000, doc: 'Most minions summoned from your hand in one combat.' },
  // SECRET TITLES v2 (owner 2026-11-20): the new bars that no metric covered.
  dwarfDamage: { cap: 100_000_000, doc: 'Damage friendly Dwarves dealt to enemy minions in combat this game.' },
  undeadFullRounds: { cap: 100, doc: 'Different rounds with 7 Undead on the board at once.' },
  spellBuffs: { cap: 1_000_000, doc: 'Spell stat buffs that landed on your minions this game (Shop and combat; each minion a buff lands on counts 1).' },
  frontToBackMin: { cap: 10_000_000, doc: 'Front to Back escalation reached (the lower of its Attack and Health bonus).' },
  // TRIBES AND MECHANICS (owner 2026-11-20: "another 100 achievements ... across tribes and mechanics"). Same trust (O).
  demonPlays: { cap: 10_000, doc: 'Demon minions played from hand this game.' },
  beastPlays: { cap: 10_000, doc: 'Beast minions played from hand this game.' },
  undeadPlays: { cap: 10_000, doc: 'Undead minions played from hand this game.' },
  dwarfAttackMax: { cap: 10_000_000, doc: 'Highest Attack of a Dwarf on the board.' },
  beastAttackMax: { cap: 10_000_000, doc: 'Highest Attack of a Beast on the board.' },
  finalSpirits: { cap: 7, doc: 'Spirits on the final board.' },
  finalUndead: { cap: 7, doc: 'Undead on the final board.' },
  finalCelestials: { cap: 7, doc: 'Celestials on the final board.' },
  handSummons: { cap: 100_000, doc: 'Minions summoned from your hand in combat this game.' },
  beastSummons: { cap: 100_000, doc: 'Friendly Beasts summoned in combat this game.' },
  echoTriggers: { cap: 1_000_000, doc: 'Friendly Echo triggers in combat this game (every Echo multiplier counted).' },
  rallies: { cap: 1_000_000, doc: 'Friendly Rally triggers in combat this game (every Rally doubler counted).' },
  shouts: { cap: 1_000_000, doc: 'Shout triggers this game (the per-turn Shout tally, summed).' },
  wardBlocks: { cap: 100_000, doc: 'Hits friendly Wards absorbed in combat this game.' },
  executeKills: { cap: 10_000, doc: 'Enemy minions destroyed by Execute this game.' },
  pummelsCombatMax: { cap: 10_000, doc: 'Most friendly Pummel payouts in one combat.' },
  pummels: { cap: 100_000, doc: 'Friendly Pummel payouts in combat this game.' },
  openingKillsCombatMax: { cap: 7, doc: 'Most enemy minions destroyed before the first attack of a combat.' },
  eotFires: { cap: 1_000_000, doc: 'End of Turn triggers this game.' },
  discovers: { cap: 10_000, doc: 'Discover picks made this game.' },
  chooseOnes: { cap: 10_000, doc: 'Choose One picks made this game.' },
  freezes: { cap: 100, doc: 'Different turns the Shop was frozen this game.' },
  refreshes: { cap: 100_000, doc: 'Shop refreshes this game (accepted ones).' },
  sells: { cap: 10_000, doc: 'Minions sold this game.' },
} as const satisfies Record<string, { cap: number; doc: string }>;

export type RunMetric = keyof typeof RUN_METRICS;
export const RUN_METRIC_KEYS: readonly RunMetric[] = Object.keys(RUN_METRICS) as RunMetric[];

/**
 * SERVER metrics: computed by `settle_progression` from its own rows, never read from the client.
 *   game                 1 for the settled game.
 *   comeback             1 when the server accepted the comeback bonus.
 *   highestDivision      the account's Career-best rank division (0 = Bronze 1 ... 17 = Ascendant 3).
 *   promoted             1 when this Ranked game promoted (rank_results.promoted).
 *   ascendantFirst       1 for a Ranked 1st started at Ascendant (division_before >= 15).
 *   demotionEscape       1 for a Top 4 in a demotion game that did not demote.
 *   brutalFirst          1 for a Ranked 1st in a lobby of strength 70+.
 *   firstStreak          consecutive Ranked 1sts ending with this game (games after the achievements epoch).
 *   topFourStreak        consecutive Ranked Top 4s ending with this game (same window).
 *   heroesPlayed         different heroes the account has completed eligible games with.
 *   heroesWon            different heroes the account has finished 1st in Ranked with.
 *   achievementsCompleted achievements completed so far (the meta family, evaluated last).
 */
export const SERVER_METRICS = [
  'game', 'comeback', 'highestDivision', 'promoted', 'ascendantFirst', 'demotionEscape', 'brutalFirst',
  'firstStreak', 'topFourStreak', 'heroesPlayed', 'heroesWon', 'achievementsCompleted',
] as const;
export type ServerMetric = typeof SERVER_METRICS[number];
/**
 * A COLLECTION achievement's metric (owner 2026-10-27, the Plushie Plate): how many of the collection's items the account
 * owns. Neither a run metric nor a settlement metric: the database keeps it from ownership itself
 * (`progression_refresh_collection` in 2026-11-03-secret-plushie-plate.sql, run whenever an item is granted), and refuses any
 * other write to it, so a client naming it in a game's metrics moves nothing.
 */
export const COLLECTION_METRIC = 'collectionOwned' as const;
export type AchievementMetric = RunMetric | ServerMetric | typeof COLLECTION_METRIC;
/** The metric evaluated LAST, after every other completion of the same settlement. */
export const META_METRIC: ServerMetric = 'achievementsCompleted';

/** The Brutal lobby bar (mirror of `c_tier_brutal` in the lobby-strength SQL). */
export const BRUTAL_LOBBY_STRENGTH = 70;
/** The first Ascendant division index (Ascendant 1). */
export const ASCENDANT_DIVISION = 15;

/**
 * Keep only known run metrics with sane values (a non-negative integer at most the cap). Unknown keys are dropped
 * (a newer client talking to an older server), never an error: a bad metric must never cost a player the game's XP.
 */
export function sanitizeRunMetrics(v: unknown): Partial<Record<RunMetric, number>> {
  const out: Partial<Record<RunMetric, number>> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const o = v as Record<string, unknown>;
  for (const k of RUN_METRIC_KEYS) {
    const x = o[k];
    if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= RUN_METRICS[k].cap) out[k] = x;
  }
  return out;
}

// ── Definitions ──────────────────────────────────────────────────────────────────────────────────────────────

export const ACHIEVEMENT_CATEGORIES = ['career', 'ranked', 'heroes', 'economy', 'mechanics', 'runes', 'set2', 'tribes', 'combat', 'milestones', 'collection', 'secret'] as const;
export type AchievementCategory = typeof ACHIEVEMENT_CATEGORIES[number];
export const ACHIEVEMENT_CATEGORY_LABELS: Readonly<Record<AchievementCategory, string>> = Object.freeze({
  career: 'Career', ranked: 'Ranked', heroes: 'Heroes', economy: 'Economy and Build', mechanics: 'Mechanics', runes: 'Runes', set2: 'Set 2',
  tribes: 'Tribes', combat: 'Combat', milestones: 'Milestones', collection: 'Collection', secret: 'Secrets',
});

/** Sub-groups (the Set 2 tribes; the others use one group). */
export const SET2_GROUPS = ['kobold', 'dwarf', 'dragon', 'beast', 'demon', 'cross', 'rune'] as const;
/** The Tribes category's groups (2026-11-20), in the secret titles' tribe order. Set-agnostic: a tribe's feats count
 *  in whichever set the tribe is played (Spirits and Undead are Set 3, Celestials Set 4; neither set is live yet). */
export const TRIBE_GROUPS = ['dwarf', 'demon', 'spirit', 'dragon', 'beast', 'undead', 'kobold', 'celestial'] as const;
export const ACHIEVEMENT_GROUP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  kobold: 'Kobolds', dwarf: 'Dwarves', dragon: 'Dragons', beast: 'Beasts', demon: 'Demons', cross: 'Cross-tribe', rune: 'Runes',
  spirit: 'Spirits', undead: 'Undead', celestial: 'Celestials',
  all: 'All heroes',
});
/** The Heroes category's account-wide group (sorted before the per-hero groups). */
export const HEROES_ALL_GROUP = 'all';

/**
 * Which settlements can move an achievement.
 *   any      Ranked, or a standard Practice (Normal Health AND a turn timer). Never the tutorial.
 *   ranked   Ranked only.
 *   tutorial The Learn Ascent graduation only.
 *   account  Every settlement (server-owned account state: the Career-best rank, distinct heroes, completions).
 */
export const ACHIEVEMENT_MODES = ['any', 'ranked', 'tutorial', 'account'] as const;
export type AchievementMode = typeof ACHIEVEMENT_MODES[number];
export const ACHIEVEMENT_AGGS = ['max', 'sum'] as const;
export type AchievementAgg = typeof ACHIEVEMENT_AGGS[number];
/** Handoff §7.4: S = server-known, O = ordinary (accepted facts, replay kept), P = prestige (replay-verified; none in batch 1). */
export const ACHIEVEMENT_TRUSTS = ['S', 'O', 'P'] as const;
export type AchievementTrust = typeof ACHIEVEMENT_TRUSTS[number];

/**
 * What completing pays. `titleId` is the reserved slot for a title reward (null for every batch 1 def). `cosmeticId` is
 * a non-title cosmetic reward (the Plushie Plate), granted by the database with the completion.
 */
export interface AchievementRewards { xp: number; titleId: string | null; cosmeticId?: string | null }

/** The Plushie Plate's reward line (owner 2026-10-27, verbatim). */
export const UNIQUE_PLATE_REWARD_TEXT = 'Unique Card Plate Only Available From Completing This Achievement';

export interface AchievementDef {
  /** Permanent. */
  id: string;
  /** Bumped when the predicate changes meaning (stored on progress rows). */
  version: number;
  name: string;
  /** Exactly what counts, in plain player text. */
  requirement: string;
  category: AchievementCategory;
  /** A sub-group inside the category (the Set 2 tribes), or null. */
  group: string | null;
  /** A tiered family id (`career.games`), or null. */
  family: string | null;
  mode: AchievementMode;
  /** Set scope: only runs of this set count (Set 2 feats). Null = any set. */
  setId: string | null;
  /** Only games with this hero count (the hero templates). */
  heroId: string | null;
  /** Only games at or better than this placement count (1 = 1st, 4 = Top 4). */
  placementMax: number | null;
  metric: AchievementMetric;
  agg: AchievementAgg;
  target: number;
  rewards: AchievementRewards;
  /** Shown blurred as "Hidden" until completed. No batch 1 def is hidden. */
  hidden: boolean;
  trust: AchievementTrust;
  batch: 1 | 2;
  /** Show a progress bar (a count toward a target larger than 1). */
  showProgress: boolean;
}

type DefInput = Omit<AchievementDef, 'version' | 'group' | 'family' | 'setId' | 'heroId' | 'placementMax' | 'agg' | 'rewards' | 'hidden' | 'trust' | 'batch' | 'showProgress'>
  & Partial<Pick<AchievementDef, 'group' | 'family' | 'setId' | 'heroId' | 'placementMax' | 'agg' | 'hidden' | 'trust' | 'showProgress'>>
  & { xp: number; titleId?: string | null; cosmeticId?: string | null };

function def(d: DefInput): AchievementDef {
  const { xp, titleId, cosmeticId, ...rest } = d;
  const agg = d.agg ?? 'max';
  return {
    version: 1, group: null, family: null, setId: null, heroId: null, placementMax: null, hidden: false, trust: 'O', batch: 1,
    showProgress: d.showProgress ?? (d.target > 1 && (agg === 'sum' || d.metric === 'heroesPlayed' || d.metric === 'heroesWon' || d.metric === 'achievementsCompleted' || d.metric === COLLECTION_METRIC || d.metric === 'firstStreak' || d.metric === 'topFourStreak')),
    ...rest,
    agg,
    rewards: cosmeticId ? { xp, titleId: titleId ?? null, cosmeticId } : { xp, titleId: titleId ?? null },
  };
}

// Career ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CAREER: AchievementDef[] = [
  def({ id: 'tutorial.complete_course', name: 'Ready to Ascend', requirement: 'Complete the Learn Ascent course.', category: 'career', mode: 'tutorial', metric: 'game', target: 1, xp: 100, trust: 'S' }),
  ...([[1, 'First Steps', 25], [10, 'Regular', 50], [50, 'Seasoned', 75], [100, 'Veteran', 300]] as const).map(([n, name, xp]) => def({
    id: `career.games.${n}`, name, requirement: n === 1 ? 'Complete a game.' : `Complete ${n} games.`, category: 'career', family: 'career.games',
    mode: 'any', metric: 'game', agg: 'sum', target: n, xp, trust: 'S',
  })),
  ...([[10, 'Contender', 50], [50, 'Mainstay', 300]] as const).map(([n, name, xp]) => def({
    id: `career.top_four.${n}`, name, requirement: `Finish Top 4 in ${n} Ranked games.`, category: 'career', family: 'career.top_four',
    mode: 'ranked', metric: 'game', agg: 'sum', placementMax: 4, target: n, xp, trust: 'S',
  })),
  ...([[5, 'Victor', 100], [25, 'Conqueror', 500]] as const).map(([n, name, xp]) => def({
    id: `career.firsts.${n}`, name, requirement: `Finish 1st in ${n} Ranked games.`, category: 'career', family: 'career.firsts',
    mode: 'ranked', metric: 'game', agg: 'sum', placementMax: 1, target: n, xp, trust: 'S',
  })),
  ...([[1, 'Never Out', 50], [10, 'Back from the Brink', 250]] as const).map(([n, name, xp]) => def({
    id: `career.comebacks.${n}`, name, requirement: n === 1 ? 'Earn the comeback bonus: win a combat right after 4 losses in a row.' : `Earn the comeback bonus ${n} times.`,
    category: 'career', family: 'career.comebacks', mode: 'any', metric: 'comeback', agg: 'sum', target: n, xp, trust: 'S',
  })),
  ...([[5, 'Well Traveled', 50], [15, 'Many Faces', 250]] as const).map(([n, name, xp]) => def({
    id: `career.heroes_played.${n}`, name, requirement: `Complete games with ${n} different heroes.`, category: 'career', family: 'career.heroes_played',
    mode: 'account', metric: 'heroesPlayed', target: n, xp, trust: 'S',
  })),
  ...([[5, 'Versatile', 100], [15, 'Master of Many', 600]] as const).map(([n, name, xp]) => def({
    id: `career.hero_wins.${n}`, name, requirement: `Finish 1st in Ranked with ${n} different heroes.`, category: 'career', family: 'career.hero_wins',
    mode: 'account', metric: 'heroesWon', target: n, xp, trust: 'S',
  })),
  ...([[10, 'Collector', 50], [25, 'Completionist', 200]] as const).map(([n, name, xp]) => def({
    id: `career.achievements.${n}`, name, requirement: `Complete ${n} achievements.`, category: 'career', family: 'career.achievements',
    mode: 'account', metric: 'achievementsCompleted', target: n, xp, trust: 'S',
  })),
];

// Ranked ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The medal names, in ladder order (mirror of RANK_MEDALS in packages/sim/src/rank.ts; the UI numerals ascend). */
export const RANK_MEDAL_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'] as const;
/** XP per division index 1..17 (index 0, Bronze 1, is where everyone starts: no achievement). */
const REACH_XP = [0, 50, 50, 75, 50, 50, 100, 75, 75, 150, 100, 100, 200, 125, 125, 300, 250, 500] as const;
/** "Silver 1" for a division index. */
export const divisionName = (index: number): string => `${RANK_MEDAL_NAMES[Math.floor(index / 3)] ?? 'Ascendant'} ${(index % 3) + 1}`;

const RANKED: AchievementDef[] = [
  def({ id: 'ranked.first_game', name: 'On the Ladder', requirement: 'Complete a Ranked game.', category: 'ranked', mode: 'ranked', metric: 'game', target: 1, xp: 25, trust: 'S' }),
  def({ id: 'ranked.first_top_four', name: 'In the Running', requirement: 'Finish Top 4 in a Ranked game.', category: 'ranked', mode: 'ranked', metric: 'game', placementMax: 4, target: 1, xp: 50, trust: 'S' }),
  def({ id: 'ranked.first_win', name: 'First Among Eight', requirement: 'Finish 1st in a Ranked game.', category: 'ranked', mode: 'ranked', metric: 'game', placementMax: 1, target: 1, xp: 100, trust: 'S' }),
  ...REACH_XP.slice(1).map((xp, i) => {
    const index = i + 1;
    const medal = (RANK_MEDAL_NAMES[Math.floor(index / 3)] ?? 'ascendant').toLowerCase();
    return def({
      id: `ranked.reach_${medal}_${(index % 3) + 1}`, name: divisionName(index), requirement: `Reach ${divisionName(index)} in Ranked.`,
      category: 'ranked', family: 'ranked.reach', mode: 'account', metric: 'highestDivision', target: index, xp, trust: 'S', showProgress: false,
    });
  }),
  def({ id: 'ranked.promotion_win', name: 'Passed the Trial', requirement: 'Win a promotion game.', category: 'ranked', family: 'ranked.promotions', mode: 'ranked', metric: 'promoted', agg: 'sum', target: 1, xp: 75, trust: 'S' }),
  def({ id: 'ranked.promotions_5', name: 'Proven Again', requirement: 'Win 5 promotion games.', category: 'ranked', family: 'ranked.promotions', mode: 'ranked', metric: 'promoted', agg: 'sum', target: 5, xp: 150, trust: 'S' }),
  def({ id: 'ranked.ascendant_wins_10', name: 'Established Above', requirement: 'Finish 1st in 10 Ranked games started at Ascendant.', category: 'ranked', mode: 'ranked', metric: 'ascendantFirst', agg: 'sum', target: 10, xp: 500, trust: 'S' }),
  def({ id: 'ranked.comeback_win', name: 'Turned Around', requirement: 'Finish 1st in a Ranked game where you earned the comeback bonus.', category: 'ranked', mode: 'ranked', metric: 'comeback', placementMax: 1, target: 1, xp: 200, trust: 'S' }),
  def({ id: 'ranked.win_streak_3', name: 'Three Straight', requirement: 'Finish 1st in 3 Ranked games in a row.', category: 'ranked', mode: 'ranked', metric: 'firstStreak', target: 3, xp: 250, trust: 'S' }),
  def({ id: 'ranked.top_four_streak_10', name: 'Consistent', requirement: 'Finish Top 4 in 10 Ranked games in a row.', category: 'ranked', mode: 'ranked', metric: 'topFourStreak', target: 10, xp: 300, trust: 'S' }),
  def({ id: 'ranked.demotion_escape', name: 'Held the Line', requirement: 'Finish Top 4 in a demotion game.', category: 'ranked', mode: 'ranked', metric: 'demotionEscape', target: 1, xp: 75, trust: 'S' }),
  def({ id: 'ranked.brutal_win', name: 'Against the Odds', requirement: `Finish 1st in a Brutal Ranked lobby (strength ${BRUTAL_LOBBY_STRENGTH} or more).`, category: 'ranked', mode: 'ranked', metric: 'brutalFirst', target: 1, xp: 200, trust: 'S' }),
];

// Heroes ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The 42 playable heroes (not archived), id and display name. The progression package stays dependency-free, so
 * the list lives here; packages/sim/src/achievementHeroes.test.ts fails CI when it drifts from `playableHeroes()`.
 * Each hero's TITLE name lives with the catalog (`HERO_TITLE_NAMES` in cosmetics.ts, owner 2026-09-29).
 */
export const ACHIEVEMENT_HEROES: ReadonlyArray<{ id: string; name: string }> = Object.freeze([
  { id: 'warden', name: 'Warden' }, { id: 'indy', name: 'Indy' }, { id: 'myra', name: 'Auctioneer' }, { id: 'soren', name: 'Soren' },
  { id: 'nadja', name: 'Nadja' }, { id: 'cassen', name: 'Cassen' }, { id: 'drakko', name: 'Drakko' }, { id: 'robin', name: 'Robin' },
  { id: 'darah', name: 'Darah' }, { id: 'risen', name: 'Lord of the Risen' }, { id: 'gildmaster', name: 'Gildmaster' },
  { id: 'discodan', name: 'Disco Dan' }, { id: 'brackus', name: 'Brackus' }, { id: 'baggerben', name: 'Rascal' },
  { id: 'hermithank', name: 'Tradesman' },
  { id: 'runesmith', name: 'Runesmith' }, { id: 'runeguard', name: 'Guardian' }, { id: 'repete', name: 'Re-Pete' }, { id: 'gorr', name: 'Gorr' }, { id: 'kindness', name: 'Kindness' },
  { id: 'merrin', name: 'Merrin' }, { id: 'gambler', name: 'Gambler' }, { id: 'xerox', name: 'Xerox' }, { id: 'frank', name: 'Frantic Frank' },
  { id: 'pete', name: 'Pete' }, { id: 'flint', name: 'Foreman Flint' }, { id: 'vale', name: 'Emissary' }, // re-enabled 2026-10-15
  { id: 'quillen', name: 'Quillen' }, { id: 'hunch', name: 'Hunch' }, { id: 'emeraldwarden', name: 'Emerald Warden' }, { id: 'underdweller', name: 'Underdweller' }, { id: 'albus', name: 'Albus' },
  { id: 'flash', name: 'Flash' }, { id: 'midas', name: 'Midas' }, { id: 'juggler', name: 'Juggler' }, { id: 'membrance', name: 'Membrance' }, { id: 'bram', name: 'Braum' },
  { id: 'cia', name: 'Ayse' }, { id: 'keshi', name: 'Keshi the Protector' }, { id: 'rayse', name: 'Rayse' }, { id: 'gorun', name: 'Gorun' }, { id: 'mimic', name: 'Mimic' },
]);

/** Ranked 1sts with a hero that earn its title, and its golden MASTER version (owner 2026-09-29). */
export const HERO_TITLE_WINS = 3;
export const HERO_MASTERY_WINS = 10;

/** The five hero templates (handoff §12.4; owner defaults 2026-09-28: Debut and Top 4 count Practice, the win tiers
 *  are Ranked only). Owner 2026-09-29: 3 Ranked 1sts grant the hero's title (`titled`, new), 10 upgrade it to the
 *  golden master version (`mastery`). Victory (1 Ranked 1st) stays an XP-only tier. */
function heroDefs(h: { id: string; name: string }): AchievementDef[] {
  const base = { category: 'heroes' as const, group: h.id, heroId: h.id, metric: 'game' as const, agg: 'sum' as const, trust: 'O' as const };
  return [
    def({ ...base, id: `hero.${h.id}.debut`, family: 'hero.debut', name: `${h.name}: Debut`, requirement: `Complete 3 games as ${h.name}.`, mode: 'any', target: 3, xp: 25 }),
    def({ ...base, id: `hero.${h.id}.top_four`, family: 'hero.top_four', name: `${h.name}: Contender`, requirement: `Finish Top 4 in 5 games as ${h.name}.`, mode: 'any', placementMax: 4, target: 5, xp: 75 }),
    def({ ...base, id: `hero.${h.id}.victory`, family: 'hero.victory', name: `${h.name}: Victory`, requirement: `Finish 1st in a Ranked game as ${h.name}.`, mode: 'ranked', placementMax: 1, target: 1, xp: 100 }),
    def({ ...base, id: `hero.${h.id}.titled`, family: 'hero.titled', name: `${h.name}: Titled`, requirement: `Finish 1st in ${HERO_TITLE_WINS} Ranked games as ${h.name}.`, mode: 'ranked', placementMax: 1, target: HERO_TITLE_WINS, xp: 150, titleId: heroTitleId(h.id) }),
    def({ ...base, id: `hero.${h.id}.mastery`, family: 'hero.mastery', name: `${h.name}: Mastery`, requirement: `Finish 1st in ${HERO_MASTERY_WINS} Ranked games as ${h.name}.`, mode: 'ranked', placementMax: 1, target: HERO_MASTERY_WINS, xp: 400, titleId: heroMasterTitleId(h.id) }),
  ];
}
const HERO_ACHIEVEMENTS: AchievementDef[] = ACHIEVEMENT_HEROES.flatMap(heroDefs);

// Economy and Build ──────────────────────────────────────────────────────────────────────────────────────────
const ECONOMY: AchievementDef[] = [
  def({ id: 'first.freeze_buy', name: 'Hold That Thought', requirement: 'Freeze the Shop, then buy a card from it next turn.', category: 'economy', mode: 'any', metric: 'frozenBuysTurnMax', target: 1, xp: 25 }),
  def({ id: 'first.gild', name: 'Worth Three', requirement: 'Gild a minion.', category: 'economy', mode: 'any', metric: 'gildsMade', target: 1, xp: 25 }),
  def({ id: 'economy.spend_turn_20', name: 'Big Turn', requirement: 'Spend 20 Gold in one turn.', category: 'economy', mode: 'any', metric: 'goldSpentTurnMax', target: 20, xp: 50 }),
  def({ id: 'economy.spend_lifetime_1000', name: 'Regular Customer', requirement: 'Spend 1,000 Gold across all your games.', category: 'economy', mode: 'any', metric: 'goldSpent', agg: 'sum', target: 1000, xp: 100 }),
  def({ id: 'economy.refresh_turn_10', name: 'Keep Looking', requirement: 'Refresh the Shop 10 times in one turn.', category: 'economy', mode: 'any', metric: 'refreshesTurnMax', target: 10, xp: 75 }),
  def({ id: 'economy.sell_turn_8', name: 'Liquid Assets', requirement: 'Sell 8 minions in one turn.', category: 'economy', mode: 'any', metric: 'sellsTurnMax', target: 8, xp: 100 }),
  def({ id: 'economy.buy_turn_10', name: 'Full Cart', requirement: 'Buy 10 cards in one turn.', category: 'economy', mode: 'any', metric: 'buysTurnMax', target: 10, xp: 100 }),
  def({ id: 'economy.play_turn_15', name: 'Quick Hands', requirement: 'Play 15 cards from your hand in one turn.', category: 'economy', mode: 'any', metric: 'playsTurnMax', target: 15, xp: 100 }),
  def({ id: 'shop.tier_six_early', name: 'Ahead of Schedule', requirement: 'Reach Shop Tier 6 by round 9.', category: 'economy', mode: 'any', metric: 'tierSixByRound9', target: 1, xp: 150 }),
  def({ id: 'shop.freeze_value', name: 'Worth the Wait', requirement: 'Buy 3 cards in one turn from a Shop you froze last turn.', category: 'economy', mode: 'any', metric: 'frozenBuysTurnMax', target: 3, xp: 75 }),
  def({ id: 'build.gilded_three', name: 'Fine Collection', requirement: 'Have 3 Gilded minions on your board at once.', category: 'economy', mode: 'any', metric: 'gildedOnBoardMax', target: 3, xp: 100 }),
  def({ id: 'build.board_1000', name: 'An Army in Full', requirement: 'Begin a combat with 1,000 total Attack and Health on your board.', category: 'economy', mode: 'any', metric: 'boardStatsCombatMax', target: 1000, xp: 300 }),
  def({ id: 'menagerie.four_tribes_win', name: 'Coalition', requirement: 'Finish 1st in Ranked with 4 tribes on your final board.', category: 'economy', mode: 'ranked', metric: 'finalTribes', placementMax: 1, target: 4, xp: 225 }),
  def({ id: 'menagerie.five_tribes_win', name: 'All Banners Raised', requirement: 'Finish 1st in Ranked with 5 tribes on your final board.', category: 'economy', mode: 'ranked', metric: 'finalTribes', placementMax: 1, target: 5, xp: 350 }),
  def({ id: 'menagerie.no_majority', name: 'Balanced Company', requirement: 'Win a combat that began with 5 or more of your minions and no tribe more than twice.', category: 'economy', mode: 'any', metric: 'balancedWin', target: 1, xp: 150 }),
];

// Mechanics ──────────────────────────────────────────────────────────────────────────────────────────────────
const MECHANICS: AchievementDef[] = [
  def({ id: 'mechanic.shouts_turn_10', name: 'Heard Around the Shop', requirement: 'Trigger 10 Shouts in one turn.', category: 'mechanics', mode: 'any', metric: 'shoutsTurnMax', target: 10, xp: 100 }),
  def({ id: 'mechanic.end_turn_8', name: 'Night Shift', requirement: 'Trigger 8 End of Turn effects in one turn.', category: 'mechanics', mode: 'any', metric: 'eotFiresMax', target: 8, xp: 150 }),
  def({ id: 'mechanic.echoes_combat_8', name: 'Long Echo', requirement: 'Trigger 8 friendly Echoes in one combat.', category: 'mechanics', mode: 'any', metric: 'echoesCombatMax', target: 8, xp: 150 }),
  def({ id: 'mechanic.ward_blocks_5', name: 'Not Today', requirement: 'Have your Wards block 5 hits in one combat.', category: 'mechanics', mode: 'any', metric: 'wardBlocksCombatMax', target: 5, xp: 150 }),
  def({ id: 'mechanic.summons_combat_15', name: 'Reinforcements', requirement: 'Summon 15 friendly minions in one combat.', category: 'mechanics', mode: 'any', metric: 'summonsCombatMax', target: 15, xp: 150 }),
  def({ id: 'counter.no_deaths', name: 'Clean Fight', requirement: 'From round 10 on, win a combat without a friendly minion dying.', category: 'mechanics', mode: 'any', metric: 'cleanWinLate', target: 1, xp: 175 }),
  def({ id: 'counter.low_stats_win', name: 'Better Plan', requirement: 'From round 8 on, win a combat you began with 70% or less of the enemy total Attack and Health.', category: 'mechanics', mode: 'any', metric: 'underdogWinLate', target: 1, xp: 250 }),
];

// Runes ──────────────────────────────────────────────────────────────────────────────────────────────────────
const RUNES: AchievementDef[] = [
  def({ id: 'rune.first_basic', name: 'First Mark', requirement: 'Forge a Basic Rune.', category: 'runes', mode: 'any', metric: 'basicRunesForged', target: 1, xp: 25 }),
  def({ id: 'rune.first_epic', name: 'Epic Inscription', requirement: 'Forge an Epic Rune.', category: 'runes', mode: 'any', metric: 'epicRunesForged', target: 1, xp: 50 }),
  def({ id: 'rune.triggers_20', name: 'Runic Engine', requirement: 'Have your Runes trigger 20 times in one game.', category: 'runes', mode: 'any', metric: 'runeTriggers', target: 20, xp: 100 }),
  def({ id: 'rune.triggers_50', name: 'Written Everywhere', requirement: 'Have your Runes trigger 50 times in one game.', category: 'runes', mode: 'any', metric: 'runeTriggers', target: 50, xp: 250 }),
  def({ id: 'rune.menagerie_win', name: 'Common Cause', requirement: 'Finish 1st in Ranked holding Menagerie, with 4 or more tribes on your final board.', category: 'runes', mode: 'ranked', metric: 'menagerieRuneFinalTribes', placementMax: 1, target: 4, xp: 250 }),
];

// Set 2 ──────────────────────────────────────────────────────────────────────────────────────────────────────
const s2 = (group: string, d: Omit<DefInput, 'category' | 'group' | 'setId'>): AchievementDef =>
  def({ ...d, category: 'set2', group, setId: 'set2' });

const SET2: AchievementDef[] = [
  // Kobolds (Rubies)
  s2('kobold', { id: 's2.kobold.rubies_turn_8', name: 'Cut and Set', requirement: 'Play 8 Rubies in one turn.', mode: 'any', metric: 'rubyPlaysTurnMax', target: 8, xp: 100 }),
  s2('kobold', { id: 's2.kobold.rubies_life_500', name: 'Gem Hoarder', requirement: 'Play 500 Rubies across all your Set 2 games.', mode: 'any', metric: 'rubyPlays', agg: 'sum', target: 500, xp: 200 }),
  s2('kobold', { id: 's2.kobold.ruby_strength_5', name: 'Master Cut', requirement: 'Raise your Rubies to a +5/+5 bonus in one game.', mode: 'any', metric: 'rubyStrength', target: 5, xp: 150 }),
  s2('kobold', { id: 's2.kobold.every_facet', name: 'Every Facet', requirement: 'Play a Warding, Golden, Splintered, Ripple and Dark Ruby on a Kobold in one game.', mode: 'any', metric: 'rubyFacetsOnKobolds', target: 5, xp: 100 }),
  s2('kobold', { id: 's2.kobold.gemstorm_15', name: 'Gemstorm', requirement: 'Have 15 Rubies land on your minions in one combat.', mode: 'any', metric: 'rubiesLandedCombatMax', target: 15, xp: 150 }),
  s2('kobold', { id: 's2.kobold.golem_40', name: 'Heart of the Mountain', requirement: 'Summon a Gemheart Golem with 40 or more total Attack and Health in combat.', mode: 'any', metric: 'golemStatsCombatMax', target: 40, xp: 175 }),
  s2('kobold', { id: 's2.kobold.win_rubies_60', name: 'Cut Above', requirement: 'Finish 1st in Ranked after playing 60 Rubies that game.', mode: 'ranked', metric: 'rubyPlays', placementMax: 1, target: 60, xp: 200 }),
  s2('kobold', { id: 's2.kobold.win_banner', name: 'Kobold Crown', requirement: 'Finish 1st in Ranked with 5 Kobolds on your final board.', mode: 'ranked', metric: 'finalKobolds', placementMax: 1, target: 5, xp: 150 }),
  // Dwarves (Gold spent, Ales)
  s2('dwarf', { id: 's2.dwarf.ales_turn_4', name: 'A Round for Everyone', requirement: 'Cast 4 Dwarven Ales in one turn.', mode: 'any', metric: 'alesTurnMax', target: 4, xp: 75 }),
  s2('dwarf', { id: 's2.dwarf.ales_turn_8', name: 'Bottomless', requirement: 'Cast 8 Dwarven Ales in one turn.', mode: 'any', metric: 'alesTurnMax', target: 8, xp: 175 }),
  s2('dwarf', { id: 's2.dwarf.tasting_flight', name: 'Tasting Flight', requirement: 'Play all five Dwarven Ales in one game.', mode: 'any', metric: 'aleKinds', target: 5, xp: 75 }),
  s2('dwarf', { id: 's2.dwarf.payroll_25', name: 'Payroll', requirement: 'Spend 25 Gold in one turn with 2 or more Dwarves on your board.', mode: 'any', metric: 'dwarfPayrollTurnMax', target: 25, xp: 100 }),
  s2('dwarf', { id: 's2.dwarf.win_ales_25', name: 'Last Call', requirement: 'Finish 1st in Ranked after casting 25 Dwarven Ales that game.', mode: 'ranked', metric: 'alesCast', placementMax: 1, target: 25, xp: 200 }),
  s2('dwarf', { id: 's2.dwarf.win_banner', name: 'Under the Mountain', requirement: 'Finish 1st in Ranked with 5 Dwarves on your final board.', mode: 'ranked', metric: 'finalDwarves', placementMax: 1, target: 5, xp: 150 }),
  // Dragons (spells, Shouts, Dragonflame)
  s2('dragon', { id: 's2.dragon.spells_turn_6', name: 'Spellfire', requirement: 'Cast 6 Shop spells in one turn. Rubies do not count.', mode: 'any', metric: 'spellsTurnMax', target: 6, xp: 100 }),
  s2('dragon', { id: 's2.dragon.spells_turn_12', name: 'Draconic Chorus', requirement: 'Cast 12 Shop spells in one turn. Rubies do not count.', mode: 'any', metric: 'spellsTurnMax', target: 12, xp: 200 }),
  s2('dragon', { id: 's2.dragon.spell_power_6', name: 'Scholar of Scales', requirement: 'Raise your spell power to +6 Attack or +6 Health.', mode: 'any', metric: 'spellPower', target: 6, xp: 150 }),
  s2('dragon', { id: 's2.dragon.roar_8', name: 'Roar of the Hoard', requirement: 'Trigger 8 Shouts in one turn with 3 or more Dragons on your board.', mode: 'any', metric: 'dragonShoutsTurnMax', target: 8, xp: 125 }),
  s2('dragon', { id: 's2.dragon.dragonflame_24', name: 'Breath of the Flight', requirement: 'In combat, have one Dragonflame give a minion +24/+24 or more.', mode: 'any', metric: 'dragonflameMax', target: 24, xp: 150 }),
  s2('dragon', { id: 's2.dragon.win_spells_40', name: 'Written in Flame', requirement: 'Finish 1st in Ranked after casting 40 Shop spells that game.', mode: 'ranked', metric: 'spellsCast', placementMax: 1, target: 40, xp: 200 }),
  s2('dragon', { id: 's2.dragon.win_banner', name: "Dragon's Hoard", requirement: 'Finish 1st in Ranked with 5 Dragons on your final board.', mode: 'ranked', metric: 'finalDragons', placementMax: 1, target: 5, xp: 150 }),
  // Beasts (Echo, summons, King Oona)
  s2('beast', { id: 's2.beast.stampede_8', name: 'Stampede', requirement: 'Trigger 8 Beast Echoes in one combat.', mode: 'any', metric: 'beastEchoesCombatMax', target: 8, xp: 150 }),
  s2('beast', { id: 's2.beast.march_12', name: 'Menagerie March', requirement: 'Summon 12 Beasts in one combat.', mode: 'any', metric: 'beastSummonsCombatMax', target: 12, xp: 150 }),
  s2('beast', { id: 's2.beast.royal_50', name: 'Royal Menagerie', requirement: 'With King Oona on your board, summon a Beast with 50 or more total Attack and Health in combat.', mode: 'any', metric: 'oonaBeastSummonMax', target: 50, xp: 150 }),
  s2('beast', { id: 's2.beast.venom_line_3', name: 'Venom Line', requirement: 'Destroy 3 enemy minions with Execute in one combat.', mode: 'any', metric: 'executeKillsCombatMax', target: 3, xp: 125 }),
  s2('beast', { id: 's2.beast.win_echoes_10', name: 'Endless Herd', requirement: 'Finish 1st in Ranked after 10 friendly Echoes in your final combat.', mode: 'ranked', metric: 'finalCombatEchoes', placementMax: 1, target: 10, xp: 200 }),
  s2('beast', { id: 's2.beast.win_banner', name: 'Wild Crown', requirement: 'Finish 1st in Ranked with 5 Beasts on your final board.', mode: 'ranked', metric: 'finalBeasts', placementMax: 1, target: 5, xp: 150 }),
  // Demons (Consume, Imps)
  s2('demon', { id: 's2.demon.appetite_5', name: 'Hearty Appetite', requirement: 'Consume 5 Shop minions in one turn.', mode: 'any', metric: 'consumesTurnMax', target: 5, xp: 100 }),
  s2('demon', { id: 's2.demon.glutton_25', name: 'Glutton', requirement: 'Consume 25 Shop minions in one game.', mode: 'any', metric: 'consumes', target: 25, xp: 150 }),
  s2('demon', { id: 's2.demon.main_course_60', name: 'Main Course', requirement: 'Consume a Shop minion with 60 or more total Attack and Health.', mode: 'any', metric: 'consumedStatsMax', target: 60, xp: 175 }),
  s2('demon', { id: 's2.demon.imp_army_10', name: 'Imp Army', requirement: 'Raise your Imp buff to +10/+10.', mode: 'any', metric: 'impBuff', target: 10, xp: 150 }),
  s2('demon', { id: 's2.demon.legion_6', name: 'Legion', requirement: 'Summon 6 Imps in one combat.', mode: 'any', metric: 'impSummonsCombatMax', target: 6, xp: 125 }),
  s2('demon', { id: 's2.demon.well_fed_150', name: 'Well Fed', requirement: 'Finish 1st in Ranked with a Demon of 150 or more total Attack and Health on your final board.', mode: 'ranked', metric: 'finalDemonStatsMax', placementMax: 1, target: 150, xp: 200 }),
  s2('demon', { id: 's2.demon.win_banner', name: 'Infernal Court', requirement: 'Finish 1st in Ranked with 5 Demons on your final board.', mode: 'ranked', metric: 'finalDemons', placementMax: 1, target: 5, xp: 150 }),
  // Cross-tribe
  s2('cross', { id: 's2.cross.mountainbond', name: 'Mountainbond', requirement: 'In one turn, spend 20 Gold and play 8 Rubies with a Dwarf and a Kobold on your board.', mode: 'any', metric: 'mountainbond', target: 1, xp: 200 }),
  s2('cross', { id: 's2.cross.dark_feast', name: 'Dark Feast', requirement: 'Have Dark Rubies consume 5 Shop minions in one game.', mode: 'any', metric: 'darkRubyConsumes', target: 5, xp: 150 }),
  s2('cross', { id: 's2.cross.liquid_courage', name: 'Liquid Courage', requirement: 'Cast 10 Shop spells in one turn, 4 of them Dwarven Ales, with a Dragon and a Dwarf on your board.', mode: 'any', metric: 'liquidCourage', target: 1, xp: 175 }),
  s2('cross', { id: 's2.cross.arcane_facets', name: 'Arcane Facets', requirement: 'Play 16 Rubies and Shop spells combined in one turn.', mode: 'any', metric: 'arcaneFacetsTurnMax', target: 16, xp: 150 }),
  s2('cross', { id: 's2.cross.feeding_frenzy', name: 'Feeding Frenzy', requirement: 'In one combat, summon 6 Beasts and 3 Imps.', mode: 'any', metric: 'feedingFrenzy', target: 1, xp: 150 }),
  // Runes
  s2('rune', { id: 's2.rune.epic_fit', name: 'Right Tool', requirement: 'Forge an Epic Rune for a tribe with 3 or more minions on your board, then win the next combat.', mode: 'any', metric: 'epicFitWin', target: 1, xp: 75 }),
  s2('rune', { id: 's2.rune.tribal_pair', name: 'Tribal Inscription', requirement: 'Finish Top 4 in Ranked holding a Basic and an Epic Rune of the same tribe.', mode: 'ranked', metric: 'tribalRunePair', placementMax: 4, target: 1, xp: 150 }),
  s2('rune', { id: 's2.rune.overtime_5', name: 'Overtime Pay', requirement: 'Have Overtime pay out 5 times in one game.', mode: 'any', metric: 'overtimeProcs', target: 5, xp: 125 }),
  s2('rune', { id: 's2.rune.blart_10', name: 'Seconds, Please', requirement: 'Have Blart share its stats 10 times in one game.', mode: 'any', metric: 'blartProcs', target: 10, xp: 125 }),
  s2('rune', { id: 's2.rune.three_engines', name: 'Three Engines', requirement: 'Have 3 different Runes each trigger 5 times in one game.', mode: 'any', metric: 'runesFivePlus', target: 3, xp: 150 }),
];

// ── ACHIEVEMENTS 150 (owner 2026-10-03) ────────────────────────────────────────────────────────────────────────
// Owner: "add 150 more achievements", themes "Tribes & cards", "Heroes deeper", "Combat feats", "Long-term grind";
// "make longer term / more difficult achievements grant significantly more xp. some of the larger longer term ones
// should easily be 500+ xp". XP only (the hero Titled / Mastery tiers stay the only title rewards). Every def reads a
// metric the client already reports, or one of the 11 new RUN metrics above (same trust, O). No SQL change: the
// catalog is code-synced by submit-progression and settle_progression reads any metric key from the facts.

/** Set 2, per tribe: the 7-of-a-tribe 1st, lifetime tribe totals on Top 4 and 1st boards. */
const TRIBE_BANNERS: ReadonlyArray<{ group: string; plural: string; metric: RunMetric; full: string; muster: string; dynasty: string }> = [
  { group: 'kobold', plural: 'Kobolds', metric: 'finalKobolds', full: 'Gem Throne', muster: 'Tunnel Muster', dynasty: 'Kobold Dynasty' },
  { group: 'dwarf', plural: 'Dwarves', metric: 'finalDwarves', full: 'Halls of Stone', muster: 'Clan Muster', dynasty: 'Mountain Kings' },
  { group: 'dragon', plural: 'Dragons', metric: 'finalDragons', full: 'Sky Throne', muster: 'Flight Muster', dynasty: 'Wyrm Dynasty' },
  { group: 'beast', plural: 'Beasts', metric: 'finalBeasts', full: 'Wild Throne', muster: 'Pack Muster', dynasty: 'Apex Dynasty' },
  { group: 'demon', plural: 'Demons', metric: 'finalDemons', full: 'Pandemonium', muster: 'Infernal Muster', dynasty: 'Demon Dynasty' },
];
const SET2_MORE: AchievementDef[] = [
  ...TRIBE_BANNERS.flatMap((t) => [
    s2(t.group, { id: `s2.${t.group}.full_banner`, family: 's2.full_banner', name: t.full, requirement: `Finish 1st in Ranked with 7 ${t.plural} on your final board.`, mode: 'ranked', metric: t.metric, placementMax: 1, target: 7, xp: 500 }),
    s2(t.group, { id: `s2.${t.group}.muster_100`, family: 's2.muster', name: t.muster, requirement: `Field 100 ${t.plural} in total on final boards that finished Top 4.`, mode: 'any', metric: t.metric, agg: 'sum', placementMax: 4, target: 100, xp: 300 }),
    s2(t.group, { id: `s2.${t.group}.dynasty_50`, family: 's2.dynasty', name: t.dynasty, requirement: `Field 50 ${t.plural} in total on final boards that finished 1st in Ranked.`, mode: 'ranked', metric: t.metric, agg: 'sum', placementMax: 1, target: 50, xp: 600 }),
  ]),
  // Kobolds
  s2('kobold', { id: 's2.kobold.rubies_life_2000', family: 's2.kobold.rubies_life', name: 'Gem Mountain', requirement: 'Play 2,000 Rubies across all your Set 2 games.', mode: 'any', metric: 'rubyPlays', agg: 'sum', target: 2000, xp: 300 }),
  s2('kobold', { id: 's2.kobold.rubies_life_5000', family: 's2.kobold.rubies_life', name: 'Crown Jeweler', requirement: 'Play 5,000 Rubies across all your Set 2 games.', mode: 'any', metric: 'rubyPlays', agg: 'sum', target: 5000, xp: 750 }),
  s2('kobold', { id: 's2.kobold.ruby_strength_10', name: 'Flawless Cut', requirement: 'Raise your Rubies to a +10/+10 bonus in one game.', mode: 'any', metric: 'rubyStrength', target: 10, xp: 400 }),
  s2('kobold', { id: 's2.kobold.golem_80', name: 'Living Mountain', requirement: 'Summon a Gemheart Golem with 80 or more total Attack and Health in combat.', mode: 'any', metric: 'golemStatsCombatMax', target: 80, xp: 300 }),
  s2('kobold', { id: 's2.kobold.rubies_turn_12', name: 'Jewel Flood', requirement: 'Play 12 Rubies in one turn.', mode: 'any', metric: 'rubyPlaysTurnMax', target: 12, xp: 250 }),
  // Dwarves
  s2('dwarf', { id: 's2.dwarf.ales_life_250', family: 's2.dwarf.ales_life', name: 'Regulars', requirement: 'Cast 250 Dwarven Ales across all your Set 2 games.', mode: 'any', metric: 'alesCast', agg: 'sum', target: 250, xp: 200 }),
  s2('dwarf', { id: 's2.dwarf.ales_life_1000', family: 's2.dwarf.ales_life', name: 'Brewmaster', requirement: 'Cast 1,000 Dwarven Ales across all your Set 2 games.', mode: 'any', metric: 'alesCast', agg: 'sum', target: 1000, xp: 600 }),
  s2('dwarf', { id: 's2.dwarf.payroll_50', name: 'Golden Payroll', requirement: 'Spend 50 Gold in one turn with 2 or more Dwarves on your board.', mode: 'any', metric: 'dwarfPayrollTurnMax', target: 50, xp: 350 }),
  s2('dwarf', { id: 's2.dwarf.ales_turn_12', name: 'Open Bar', requirement: 'Cast 12 Dwarven Ales in one turn.', mode: 'any', metric: 'alesTurnMax', target: 12, xp: 400 }),
  // Dragons
  s2('dragon', { id: 's2.dragon.spells_life_500', family: 's2.dragon.spells_life', name: 'Spellbook', requirement: 'Cast 500 Shop spells across all your Set 2 games. Rubies do not count.', mode: 'any', metric: 'spellsCast', agg: 'sum', target: 500, xp: 250 }),
  s2('dragon', { id: 's2.dragon.spells_life_2000', family: 's2.dragon.spells_life', name: 'Archmage', requirement: 'Cast 2,000 Shop spells across all your Set 2 games. Rubies do not count.', mode: 'any', metric: 'spellsCast', agg: 'sum', target: 2000, xp: 750 }),
  s2('dragon', { id: 's2.dragon.spell_power_12', name: 'Elder Scholar', requirement: 'Raise your spell power to +12 Attack or +12 Health.', mode: 'any', metric: 'spellPower', target: 12, xp: 400 }),
  s2('dragon', { id: 's2.dragon.dragonflame_50', name: 'Wildfire', requirement: 'In combat, have one Dragonflame give a minion +50/+50 or more.', mode: 'any', metric: 'dragonflameMax', target: 50, xp: 350 }),
  // Beasts
  s2('beast', { id: 's2.beast.stampede_12', name: 'Thundering Herd', requirement: 'Trigger 12 Beast Echoes in one combat.', mode: 'any', metric: 'beastEchoesCombatMax', target: 12, xp: 300 }),
  s2('beast', { id: 's2.beast.march_20', name: 'Great Migration', requirement: 'Summon 20 Beasts in one combat.', mode: 'any', metric: 'beastSummonsCombatMax', target: 20, xp: 350 }),
  s2('beast', { id: 's2.beast.royal_100', name: 'Beast of Legend', requirement: 'With King Oona on your board, summon a Beast with 100 or more total Attack and Health in combat.', mode: 'any', metric: 'oonaBeastSummonMax', target: 100, xp: 350 }),
  s2('beast', { id: 's2.beast.venom_line_5', name: 'Venom Tide', requirement: 'Destroy 5 enemy minions with Execute in one combat.', mode: 'any', metric: 'executeKillsCombatMax', target: 5, xp: 300 }),
  // Demons
  s2('demon', { id: 's2.demon.consumes_life_250', family: 's2.demon.consumes_life', name: 'Bottomless Pit', requirement: 'Consume 250 Shop minions across all your Set 2 games.', mode: 'any', metric: 'consumes', agg: 'sum', target: 250, xp: 200 }),
  s2('demon', { id: 's2.demon.consumes_life_1000', family: 's2.demon.consumes_life', name: 'Devourer of Shops', requirement: 'Consume 1,000 Shop minions across all your Set 2 games.', mode: 'any', metric: 'consumes', agg: 'sum', target: 1000, xp: 600 }),
  s2('demon', { id: 's2.demon.imp_buff_20', name: 'Imp Overlord', requirement: 'Raise your Imp buff to +20/+20.', mode: 'any', metric: 'impBuff', target: 20, xp: 400 }),
  s2('demon', { id: 's2.demon.feast_150', name: 'Feast of Ages', requirement: 'Consume a Shop minion with 150 or more total Attack and Health.', mode: 'any', metric: 'consumedStatsMax', target: 150, xp: 350 }),
  s2('demon', { id: 's2.demon.gorged_300', name: 'Gorged', requirement: 'Finish 1st in Ranked with a Demon of 300 or more total Attack and Health on your final board.', mode: 'ranked', metric: 'finalDemonStatsMax', placementMax: 1, target: 300, xp: 500 }),
  s2('demon', { id: 's2.demon.legion_10', name: 'Infernal Legion', requirement: 'Summon 10 Imps in one combat.', mode: 'any', metric: 'impSummonsCombatMax', target: 10, xp: 300 }),
];

/** Heroes, deeper: a sixth tier per hero, plus the account-wide hero feats (the "All heroes" group). */
export const HERO_DEVOTED_GAMES = 25;
const HERO_DEVOTED: AchievementDef[] = ACHIEVEMENT_HEROES.map((h) => def({
  id: `hero.${h.id}.devoted`, family: 'hero.devoted', name: `${h.name}: Devoted`, requirement: `Complete ${HERO_DEVOTED_GAMES} games as ${h.name}.`,
  category: 'heroes', group: h.id, heroId: h.id, mode: 'any', metric: 'game', agg: 'sum', target: HERO_DEVOTED_GAMES, xp: 200,
}));
const heroAll = (d: Omit<DefInput, 'category' | 'group'>): AchievementDef => def({ ...d, category: 'heroes', group: HEROES_ALL_GROUP });
const n0 = (n: number): string => n.toLocaleString('en-US');
const HEROES_ALL: AchievementDef[] = [
  ...([[50, 'Hands On', 100], [250, 'Signature Move', 300], [1000, 'Second Nature', 750]] as const).map(([n, name, xp]) => heroAll({
    id: `hero.power_uses.${n}`, family: 'hero.power_uses', name, requirement: `Use your hero power ${n0(n)} times.`,
    mode: 'any', metric: 'heroPowerUses', agg: 'sum', target: n, xp,
  })),
  ...([[25, 'Thousand Faces', 300], [30, 'Every Mask', 500]] as const).map(([n, name, xp]) => heroAll({
    id: `career.heroes_played.${n}`, family: 'career.heroes_played', name, requirement: `Complete games with ${n} different heroes.`,
    mode: 'account', metric: 'heroesPlayed', target: n, xp, trust: 'S',
  })),
  heroAll({ id: 'career.hero_wins.25', family: 'career.hero_wins', name: 'Champion of All', requirement: 'Finish 1st in Ranked with 25 different heroes.', mode: 'account', metric: 'heroesWon', target: 25, xp: 1000, trust: 'S' }),
];

/** Combat feats (the new Combat category). */
const cb = (d: Omit<DefInput, 'category'>): AchievementDef => def({ ...d, category: 'combat' });
const COMBAT: AchievementDef[] = [
  // Flawless: no friendly minion died
  cb({ id: 'combat.flawless_win', family: 'combat.flawless_game', name: 'Untouched', requirement: 'Win a combat without a friendly minion dying.', mode: 'any', metric: 'flawlessWins', target: 1, xp: 25 }),
  cb({ id: 'combat.flawless_game_3', family: 'combat.flawless_game', name: 'Composed', requirement: 'Win 3 combats in one game without a friendly minion dying.', mode: 'any', metric: 'flawlessWins', target: 3, xp: 100 }),
  cb({ id: 'combat.flawless_game_5', family: 'combat.flawless_game', name: 'Spotless Campaign', requirement: 'Win 5 combats in one game without a friendly minion dying.', mode: 'any', metric: 'flawlessWins', target: 5, xp: 250 }),
  cb({ id: 'combat.flawless_life_25', family: 'combat.flawless_life', name: 'Perfect Record', requirement: 'Win 25 combats without a friendly minion dying, across all your games.', mode: 'any', metric: 'flawlessWins', agg: 'sum', target: 25, xp: 300 }),
  cb({ id: 'combat.flawless_life_100', family: 'combat.flawless_life', name: 'Untouchable', requirement: 'Win 100 combats without a friendly minion dying, across all your games.', mode: 'any', metric: 'flawlessWins', agg: 'sum', target: 100, xp: 750 }),
  // Last stand: exactly one survivor
  cb({ id: 'combat.last_stand', family: 'combat.last_stand', name: 'Last One Standing', requirement: 'Win a combat with only 1 of your minions left alive.', mode: 'any', metric: 'lastStandWins', target: 1, xp: 50 }),
  cb({ id: 'combat.last_stand_life_10', family: 'combat.last_stand', name: 'By a Thread', requirement: 'Win 10 combats with only 1 of your minions left alive.', mode: 'any', metric: 'lastStandWins', agg: 'sum', target: 10, xp: 250 }),
  // Win streaks inside one game
  ...([[5, 'On a Roll', 75], [8, 'Unstoppable', 250], [12, 'Juggernaut', 600]] as const).map(([n, name, xp]) => cb({
    id: `combat.streak_${n}`, family: 'combat.streak', name, requirement: `Win ${n} combats in a row in one game.`, mode: 'any', metric: 'combatWinStreakMax', target: n, xp,
  })),
  cb({ id: 'combat.undefeated_win', name: 'Unbeaten', requirement: 'Finish 1st in Ranked without losing a combat.', mode: 'ranked', metric: 'undefeated', placementMax: 1, target: 1, xp: 750 }),
  // Knockouts
  cb({ id: 'combat.knockout', family: 'combat.knockout_game', name: 'First Blood', requirement: 'Knock out a player.', mode: 'any', metric: 'knockouts', target: 1, xp: 50 }),
  cb({ id: 'combat.knockout_game_3', family: 'combat.knockout_game', name: 'Kingslayer', requirement: 'Knock out 3 players in one game.', mode: 'any', metric: 'knockouts', target: 3, xp: 300 }),
  cb({ id: 'combat.knockout_game_5', family: 'combat.knockout_game', name: 'Table Clearer', requirement: 'Knock out 5 players in one game.', mode: 'any', metric: 'knockouts', target: 5, xp: 750 }),
  cb({ id: 'combat.knockout_win_3', name: 'Conquest', requirement: 'Finish 1st in Ranked after knocking out 3 players that game.', mode: 'ranked', metric: 'knockouts', placementMax: 1, target: 3, xp: 500 }),
  cb({ id: 'combat.knockout_life_25', family: 'combat.knockout_life', name: 'Headhunter', requirement: 'Knock out 25 players across all your games.', mode: 'any', metric: 'knockouts', agg: 'sum', target: 25, xp: 400 }),
  cb({ id: 'combat.knockout_life_100', family: 'combat.knockout_life', name: 'Executioner', requirement: 'Knock out 100 players across all your games.', mode: 'any', metric: 'knockouts', agg: 'sum', target: 100, xp: 1000 }),
  // Damage to opponents
  ...([[10, 'Heavy Blow', 50], [15, 'Hammer Blow', 100], [20, 'Crushing Blow', 200], [30, 'Annihilation', 500]] as const).map(([n, name, xp]) => cb({
    id: `combat.hero_damage_${n}`, family: 'combat.hero_damage', name, requirement: `Deal ${n} damage to an opponent in one fight.`, mode: 'any', metric: 'heroDamageCombatMax', target: n, xp,
  })),
  cb({ id: 'combat.hero_damage_life_500', family: 'combat.hero_damage_life', name: 'Siege Engine', requirement: 'Deal 500 damage to opponents across all your games.', mode: 'any', metric: 'heroDamageDealt', agg: 'sum', target: 500, xp: 300 }),
  cb({ id: 'combat.hero_damage_life_2500', family: 'combat.hero_damage_life', name: 'World Breaker', requirement: 'Deal 2,500 damage to opponents across all your games.', mode: 'any', metric: 'heroDamageDealt', agg: 'sum', target: 2500, xp: 750 }),
  // Enemy minions destroyed
  ...([[7, 'Clean Sweep', 50], [10, 'Rout', 125], [12, 'Massacre', 250]] as const).map(([n, name, xp]) => cb({
    id: `combat.kills_combat_${n}`, family: 'combat.kills_combat', name, requirement: `Destroy ${n} enemy minions in one combat.`, mode: 'any', metric: 'enemyKillsCombatMax', target: n, xp,
  })),
  cb({ id: 'combat.kills_life_1000', family: 'combat.kills_life', name: 'Thousand Fallen', requirement: 'Destroy 1,000 enemy minions across all your games.', mode: 'any', metric: 'enemyKills', agg: 'sum', target: 1000, xp: 300 }),
  cb({ id: 'combat.kills_life_5000', family: 'combat.kills_life', name: 'Endless War', requirement: 'Destroy 5,000 enemy minions across all your games.', mode: 'any', metric: 'enemyKills', agg: 'sum', target: 5000, xp: 1000 }),
  // On the brink
  cb({ id: 'combat.brink_top_four', family: 'combat.brink', name: 'Still Standing', requirement: 'Finish Top 4 after falling to 5 or less Health.', mode: 'any', metric: 'brink', placementMax: 4, target: 1, xp: 200 }),
  cb({ id: 'combat.brink_win', family: 'combat.brink', name: 'From the Brink', requirement: 'Finish 1st in Ranked after falling to 5 or less Health.', mode: 'ranked', metric: 'brink', placementMax: 1, target: 1, xp: 600 }),
  cb({ id: 'career.comebacks.25', family: 'career.comebacks', name: 'Never Say Die', requirement: 'Earn the comeback bonus 25 times.', mode: 'any', metric: 'comeback', agg: 'sum', target: 25, xp: 300, trust: 'S' }),
  // Bigger fights on the existing combat counters
  cb({ id: 'combat.board_2500', family: 'build.board', name: 'Grand Army', requirement: 'Begin a combat with 2,500 total Attack and Health on your board.', mode: 'any', metric: 'boardStatsCombatMax', target: 2500, xp: 400 }),
  cb({ id: 'combat.board_5000', family: 'build.board', name: 'Legion of Legends', requirement: 'Begin a combat with 5,000 total Attack and Health on your board.', mode: 'any', metric: 'boardStatsCombatMax', target: 5000, xp: 750 }),
  cb({ id: 'combat.summons_25', name: 'Endless Ranks', requirement: 'Summon 25 friendly minions in one combat.', mode: 'any', metric: 'summonsCombatMax', target: 25, xp: 300 }),
  cb({ id: 'combat.echoes_15', name: 'Chorus of the Fallen', requirement: 'Trigger 15 friendly Echoes in one combat.', mode: 'any', metric: 'echoesCombatMax', target: 15, xp: 300 }),
  cb({ id: 'combat.wards_10', name: 'Unbreakable Wall', requirement: 'Have your Wards block 10 hits in one combat.', mode: 'any', metric: 'wardBlocksCombatMax', target: 10, xp: 300 }),
];

/** Long-term grind (the new Milestones category). Higher tiers of the batch 1 families keep their family id. */
const ms = (d: Omit<DefInput, 'category'>): AchievementDef => def({ ...d, category: 'milestones' });
const MILESTONES: AchievementDef[] = [
  ...([[250, 'Old Hand', 400], [500, 'Lifer', 750], [1000, 'Eternal', 1500]] as const).map(([n, name, xp]) => ms({
    id: `career.games.${n}`, family: 'career.games', name, requirement: `Complete ${n0(n)} games.`, mode: 'any', metric: 'game', agg: 'sum', target: n, xp, trust: 'S',
  })),
  ...([[50, 'Ladder Regular', 200], [250, 'Ladder Fixture', 500], [500, 'Ladder Legend', 1000], [1000, 'Ladder Eternal', 1500]] as const).map(([n, name, xp]) => ms({
    id: `ranked.games.${n}`, family: 'ranked.games', name, requirement: `Complete ${n0(n)} Ranked games.`, mode: 'ranked', metric: 'game', agg: 'sum', target: n, xp, trust: 'S',
  })),
  ...([[100, 'Perennial', 300], [250, 'Pillar', 750], [500, 'Monument', 1250]] as const).map(([n, name, xp]) => ms({
    id: `career.top_four.${n}`, family: 'career.top_four', name, requirement: `Finish Top 4 in ${n0(n)} Ranked games.`, mode: 'ranked', metric: 'game', agg: 'sum', placementMax: 4, target: n, xp, trust: 'S',
  })),
  ...([[50, 'Champion', 500], [100, 'Warlord', 900], [250, 'Undying Legend', 1500]] as const).map(([n, name, xp]) => ms({
    id: `career.firsts.${n}`, family: 'career.firsts', name, requirement: `Finish 1st in ${n0(n)} Ranked games.`, mode: 'ranked', metric: 'game', agg: 'sum', placementMax: 1, target: n, xp, trust: 'S',
    // Owner 2026-11-20: "add a title for 100 wins called Ascenteerianologist". A visible title reward on Warlord.
    ...(n === 100 ? { titleId: FIRSTS_100_TITLE_ID } : {}),
  })),
  ...([[5000, 'Big Spender', 200], [25000, 'Tycoon', 500], [100000, 'Golden Age', 1000]] as const).map(([n, name, xp]) => ms({
    id: `economy.spend_lifetime_${n}`, family: 'economy.spend_lifetime', name, requirement: `Spend ${n0(n)} Gold across all your games.`, mode: 'any', metric: 'goldSpent', agg: 'sum', target: n, xp,
  })),
  ...([[25, 'Goldsmith', 100], [100, 'Master Goldsmith', 300], [500, 'Gilded Age', 750]] as const).map(([n, name, xp]) => ms({
    id: `build.gilds_lifetime_${n}`, family: 'build.gilds_lifetime', name, requirement: `Gild ${n0(n)} minions across all your games.`, mode: 'any', metric: 'gildsMade', agg: 'sum', target: n, xp,
  })),
  ...([[50, 'Stonecutter', 200], [200, 'Master Carver', 500]] as const).map(([n, name, xp]) => ms({
    id: `rune.basic_lifetime_${n}`, family: 'rune.basic_lifetime', name, requirement: `Forge ${n0(n)} Basic Runes across all your games.`, mode: 'any', metric: 'basicRunesForged', agg: 'sum', target: n, xp,
  })),
  ms({ id: 'rune.epic_lifetime_25', name: 'Rune Lord', requirement: 'Forge 25 Epic Runes across all your games.', mode: 'any', metric: 'epicRunesForged', agg: 'sum', target: 25, xp: 300 }),
  ...([[1000, 'Humming Stones', 300], [5000, 'Eternal Engine', 750]] as const).map(([n, name, xp]) => ms({
    id: `rune.triggers_lifetime_${n}`, family: 'rune.triggers_lifetime', name, requirement: `Have your Runes trigger ${n0(n)} times across all your games.`, mode: 'any', metric: 'runeTriggers', agg: 'sum', target: n, xp,
  })),
  ...([[10, 'Rising Star', 300], [25, 'Ever Upward', 600]] as const).map(([n, name, xp]) => ms({
    id: `ranked.promotions_${n}`, family: 'ranked.promotions', name, requirement: `Win ${n} promotion games.`, mode: 'ranked', metric: 'promoted', agg: 'sum', target: n, xp, trust: 'S',
  })),
  ...([[50, 'Trophy Case', 200], [100, 'Hall of Trophies', 400], [200, 'Living Legend', 750]] as const).map(([n, name, xp]) => ms({
    id: `career.achievements.${n}`, family: 'career.achievements', name, requirement: `Complete ${n} achievements.`, mode: 'account', metric: 'achievementsCompleted', target: n, xp, trust: 'S',
  })),
  ms({ id: 'ranked.ascendant_wins_25', name: 'Throne Above', requirement: 'Finish 1st in 25 Ranked games started at Ascendant.', mode: 'ranked', metric: 'ascendantFirst', agg: 'sum', target: 25, xp: 1250, trust: 'S' }),
  ms({ id: 'ranked.brutal_wins_10', name: 'Giant Slayer', requirement: `Finish 1st in 10 Brutal Ranked lobbies (strength ${BRUTAL_LOBBY_STRENGTH} or more).`, mode: 'ranked', metric: 'brutalFirst', agg: 'sum', target: 10, xp: 600, trust: 'S' }),
  ms({ id: 'ranked.demotion_escapes_10', name: 'Unyielding', requirement: 'Finish Top 4 in 10 demotion games.', mode: 'ranked', metric: 'demotionEscape', agg: 'sum', target: 10, xp: 300, trust: 'S' }),
  ms({ id: 'ranked.top_four_streak_20', name: 'Rock Steady', requirement: 'Finish Top 4 in 20 Ranked games in a row.', mode: 'ranked', metric: 'topFourStreak', target: 20, xp: 750, trust: 'S' }),
  ms({ id: 'ranked.win_streak_5', name: 'Five Crowns', requirement: 'Finish 1st in 5 Ranked games in a row.', mode: 'ranked', metric: 'firstStreak', target: 5, xp: 1000, trust: 'S' }),
];

// Owner 2026-10-03 ("yes apply these achievement changes"): the batch 1 long-term tiers re-tuned onto the same curve
// (career.games.100 300, career.top_four.50 300, career.firsts.25 500, career.comebacks.10 250,
// career.heroes_played.15 250, career.hero_wins.15 600, career.achievements.25 200, s2.kobold.rubies_life_500 200,
// hero.<id>.mastery 400). Completions already paid keep the XP they paid (achievement_completions.xp_awarded).

/**
 * COLLECTION (owner 2026-10-27): "create a new achievement and say the reward is a 'Unique Card Plate Only Available From
 * Completing This Achievement'". Visible with a progress bar; the target is the collection's size, so a new Plushie Beast
 * raises it (a player who already completed it keeps it). No XP: the plate is the reward.
 */
const COLLECTION: AchievementDef[] = [
  def({
    id: PLUSHIE_BEASTS_COLLECTION_ID, name: 'Plushie Collector', requirement: 'Own every Plushie Beast skin.', category: 'collection',
    mode: 'account', metric: COLLECTION_METRIC, target: collectionMembers(PLUSHIE_BEASTS_COLLECTION_ID).length, xp: 0,
    cosmeticId: PLUSHIE_PLATE_ID, trust: 'S',
  }),
];

/**
 * SECRET TITLES (owner 2026-11-20: "50 new SECRET titles, each earned by an in-game feat ... they should all be tied to
 * hidden achievements, so unlocking them grants xp too and it's easier to track in game"; then "add 5 more titles per
 * tribe"; then the v2 pass with new names, higher bars and a Spell trio). Each is ONE hidden achievement (the Secrets
 * category, a blurred "Hidden" tile until earned) that pays XP and grants its own Secret-rarity title
 * (`SECRET_TITLE_NAMES` in cosmetics.ts holds the names; the title id is `title_secret_<key>`, the achievement id
 * `secret.<key>`, both permanent). Every one reads a RUN metric the observer counts (packages/sim achievementMetrics.ts).
 * Two of the owner's first 50 are not built (no reliable signal yet): Avenger (Avenge triggers are not logged) and
 * Indecisive (no Discover reroll action exists, and a hero select allows one reroll).
 * Gates follow the existing feats: "win the game" = 1st in Ranked; a Top 4 / final 2 finish counts any eligible game.
 * Display order is the theme order of `SECRET_TITLE_NAMES` (tribes, Spell, Coin, Steel, Royal, Jester).
 */
interface SecretFeat { key: string; requirement: string; metric: RunMetric; target: number; xp: number; mode?: AchievementMode; placementMax?: number }
const SECRET_FEATS: readonly SecretFeat[] = [
  // Dwarf
  { key: 'king_brills_jester', requirement: 'Play 80 Dwarves in one game.', metric: 'dwarfPlays', target: 80, xp: 400 },
  { key: 'bling_beard', requirement: 'Have 7 Gilded Dwarves on your board at once.', metric: 'dwarfGildedMax', target: 7, xp: 500 },
  { key: 'drunken_hero', requirement: 'Cast 75 Dwarven Ales in one game.', metric: 'alesCast', target: 75, xp: 550 },
  { key: 'effin_rich', requirement: 'Spend 150 Gold in one turn with 5 or more Dwarves on your board.', metric: 'dwarfHallSpendTurnMax', target: 150, xp: 500 },
  { key: 'the_paymaster', requirement: 'Bank 25 Gold for next turn during one combat.', metric: 'combatGoldMax', target: 25, xp: 550 },
  { key: 'dwarven', requirement: 'Have your Dwarves deal 10,000 damage in one game.', metric: 'dwarfDamage', target: 10_000, xp: 500 },
  // Demon
  { key: 'imp_lord', requirement: 'Summon 100 Imps in combat in one game.', metric: 'impSummons', target: 100, xp: 500 },
  { key: 'hungry_hippo', requirement: 'Consume 80 Shop minions in one game.', metric: 'consumes', target: 80, xp: 500 },
  { key: 'gilded_horns', requirement: 'Have 7 Gilded Demons on your board at once.', metric: 'demonGildedMax', target: 7, xp: 500 },
  { key: 'big_red', requirement: 'Have a Demon with 1,000 Attack on your board.', metric: 'demonAttackMax', target: 1_000, xp: 500 },
  { key: 'all_you_can_eat', requirement: 'Consume 12 Shop minions in one turn.', metric: 'consumesTurnMax', target: 12, xp: 550 },
  { key: 'swarm_season', requirement: 'Summon 25 Imps in one combat.', metric: 'impSummonsCombatMax', target: 25, xp: 600 },
  { key: 'hellfire', requirement: 'Have your Demons deal 5,000 damage to enemy minions in one combat.', metric: 'demonDamageCombatMax', target: 5_000, xp: 500 },
  // Spirit
  { key: 'ghost_town', requirement: 'Have 7 Spirits on your board at once in 5 different rounds of one game.', metric: 'spiritFullRounds', target: 5, xp: 450 },
  { key: 'gilded_ghost', requirement: 'Have 7 Gilded Spirits on your board at once.', metric: 'spiritGildedMax', target: 7, xp: 500 },
  { key: 'party_animal', requirement: 'Sell 25 Revelers in one game.', metric: 'revelerSells', target: 25, xp: 500 },
  { key: 'hand_me_downs', requirement: 'Summon 15 minions from your hand in one combat.', metric: 'handSummonsCombatMax', target: 15, xp: 550 },
  { key: 'spirit_guide', requirement: 'Play 60 Spirits in one game.', metric: 'spiritPlays', target: 60, xp: 450 },
  { key: 'poltergeist', requirement: 'Have a Spirit with 1,000 Attack on your board.', metric: 'spiritAttackMax', target: 1_000, xp: 450 },
  // Dragon
  { key: 'dragon_rider', requirement: 'Play 75 Dragons in one game.', metric: 'dragonPlays', target: 75, xp: 500 },
  { key: 'nest_egg', requirement: 'Start a turn with 50 Gold.', metric: 'goldTurnStartMax', target: 50, xp: 500 },
  { key: 'gilded_scales', requirement: 'Have 7 Gilded Dragons on your board at once.', metric: 'dragonGildedMax', target: 7, xp: 500 },
  { key: 'loudmouth', requirement: 'Trigger 30 Shouts in one turn with 3 or more Dragons on your board.', metric: 'dragonShoutsTurnMax', target: 30, xp: 550 },
  { key: 'big_brain', requirement: 'Raise your spell power to +40 Attack or +40 Health.', metric: 'spellPower', target: 40, xp: 750 },
  { key: 'flamethrower', requirement: 'In combat, have one Dragonflame give a minion +500/+500 or more.', metric: 'dragonflameMax', target: 500, xp: 700 },
  { key: 'big_lizard', requirement: 'Have a Dragon with 1,000 Attack on your board.', metric: 'dragonAttackMax', target: 1_000, xp: 450 },
  // Beast
  { key: 'zookeeper', requirement: 'Finish 1st in Ranked with 7 different Beasts and nothing else on your final board.', metric: 'finalBeastPack', target: 7, xp: 600, mode: 'ranked', placementMax: 1 },
  { key: 'fat_cats', requirement: 'Have 7 Gilded Beasts on your board at once.', metric: 'beastGildedMax', target: 7, xp: 500 },
  { key: 'king_of_the_jungle', requirement: 'With King Oona on your board, summon a Beast with 2,000 or more total Attack and Health in combat.', metric: 'oonaBeastSummonMax', target: 2_000, xp: 700 },
  { key: 'call_of_the_wild', requirement: 'Trigger 30 Beast Echoes in one combat.', metric: 'beastEchoesCombatMax', target: 30, xp: 600 },
  { key: 'let_the_dogs_out', requirement: 'Summon 20 Beasts in one combat.', metric: 'beastSummonsCombatMax', target: 20, xp: 500 },
  { key: 'apex_predator', requirement: 'Destroy 10 enemy minions with Execute in one combat.', metric: 'executeKillsCombatMax', target: 10, xp: 550 },
  // Undead
  { key: 'back_again', requirement: 'Have your Undead Rise 60 times in combat in one game.', metric: 'undeadRises', target: 60, xp: 500 },
  { key: 'bling_bones', requirement: 'Have 7 Gilded Undead on your board at once.', metric: 'undeadGildedMax', target: 7, xp: 500 },
  { key: 'wont_stay_dead', requirement: 'Have your Undead Rise 15 times in one combat.', metric: 'undeadRisesCombatMax', target: 15, xp: 550 },
  { key: 'skeleton_crew', requirement: 'Summon 25 Skeletons in one combat.', metric: 'skeletonSummonsCombatMax', target: 25, xp: 500 },
  { key: 'grim_reaper', requirement: 'Have an Undead with 1,000 Attack on your board.', metric: 'undeadAttackMax', target: 1_000, xp: 450 },
  { key: 'graveyard_shift', requirement: 'Have 7 Undead on your board at once in 5 different rounds of one game.', metric: 'undeadFullRounds', target: 5, xp: 450 },
  // Kobold
  { key: 'tunnel_rat', requirement: 'Play 80 Kobolds in one game.', metric: 'koboldPlays', target: 80, xp: 400 },
  { key: 'ruby_rich', requirement: 'Play 150 Rubies in one game.', metric: 'rubyPlays', target: 150, xp: 450 },
  { key: 'gilt_digger', requirement: 'Have 7 Gilded Kobolds on your board at once.', metric: 'koboldGildedMax', target: 7, xp: 500 },
  { key: 'mother_lode', requirement: 'Play 30 Rubies in one turn.', metric: 'rubyPlaysTurnMax', target: 30, xp: 550 },
  { key: 'babysitter', requirement: 'Have 5 Kobebes on your board at once.', metric: 'kobebesMax', target: 5, xp: 450 },
  { key: 'crown_jewels', requirement: 'Raise your Rubies to a +30/+30 bonus in one game.', metric: 'rubyStrength', target: 30, xp: 750 },
  { key: 'small_but_mighty', requirement: 'Have a Kobold with 1,000 Attack on your board.', metric: 'koboldAttackMax', target: 1_000, xp: 450 },
  // Celestial
  { key: 'starstruck', requirement: 'Grow a Starform to 150 Attack in the Shop.', metric: 'starformAttackMax', target: 150, xp: 450 },
  { key: 'spellbound', requirement: 'Cast 40 Shop spells in one turn.', metric: 'spellsTurnMax', target: 40, xp: 550 },
  { key: 'gilded_hour', requirement: 'Have 7 Gilded Celestials on your board at once.', metric: 'celestialGildedMax', target: 7, xp: 500 },
  { key: 'supernova', requirement: 'Grow a Starform to 500 Attack in the Shop.', metric: 'starformAttackMax', target: 500, xp: 700 },
  { key: 'space_cadet', requirement: 'Play 60 Celestials in one game.', metric: 'celestialPlays', target: 60, xp: 450 },
  { key: 'superstar', requirement: 'Have a Celestial with 1,000 Attack on your board.', metric: 'celestialAttackMax', target: 1_000, xp: 450 },
  { key: 'stargazer', requirement: 'Cast 25 Shop spells in one turn with 3 or more Celestials on your board.', metric: 'celestialSpellsTurnMax', target: 25, xp: 550 },
  // Spell (owner v2: a new group)
  { key: 'spell_slinger', requirement: 'Cast 200 spells in one game.', metric: 'spellsCast', target: 200, xp: 500 },
  { key: 'hocus_pocus', requirement: 'Buff minions with spells 300 times in one game. Each buff on each minion counts.', metric: 'spellBuffs', target: 300, xp: 500 },
  { key: 'yazzus_himself', requirement: 'Raise Front to Back to +500/+500.', metric: 'frontToBackMin', target: 500, xp: 800 },
  // Coin
  { key: 'window_shopper', requirement: 'Refresh the Shop 40 times in one turn.', metric: 'refreshesTurnMax', target: 40, xp: 400 },
  { key: 'no_rerolls', requirement: 'Finish 1st in Ranked without ever refreshing the Shop.', metric: 'noRefreshGame', target: 1, xp: 600, mode: 'ranked', placementMax: 1 },
  { key: 'money_to_burn', requirement: 'Spend 75 Gold in one turn.', metric: 'goldSpentTurnMax', target: 75, xp: 450 },
  { key: 'buyers_remorse', requirement: 'Sell 15 minions in one turn.', metric: 'sellsTurnMax', target: 15, xp: 350 },
  { key: 'cheapskate', requirement: 'Finish in the final 2 without ever going past Shop Tier 3.', metric: 'lowTierGame', target: 1, xp: 500, placementMax: 2 },
  { key: 'fast_track', requirement: 'Reach Shop Tier 6 by round 6.', metric: 'tierSixByRound6', target: 1, xp: 500 },
  { key: 'late_bloomer', requirement: 'Finish 1st in Ranked after first reaching Shop Tier 6 on round 13 or later.', metric: 'lateTierSix', target: 1, xp: 350, mode: 'ranked', placementMax: 1 },
  { key: 'flat_broke', requirement: 'End 8 turns in a row with exactly 0 Gold.', metric: 'zeroGoldStreakMax', target: 8, xp: 350 },
  { key: 'deal_hunter', requirement: 'Buy 30 discounted minions in one game.', metric: 'discountBuys', target: 30, xp: 350 },
  { key: 'midas_touch', requirement: 'Have 7 Gilded minions on your board at once.', metric: 'gildedOnBoardMax', target: 7, xp: 500 },
  { key: 'triple_threat', requirement: 'Gild 20 minions in one game.', metric: 'gildsMade', target: 20, xp: 500 },
  // Steel (combat)
  { key: 'by_a_hair', requirement: 'Win a combat with 1 minion left, on exactly 1 Health.', metric: 'lastStandOneHp', target: 1, xp: 300 },
  { key: 'comeback_kid', requirement: 'Win a combat after being down to 1 minion against 7.', metric: 'comebackOneVsSeven', target: 1, xp: 500 },
  { key: 'overkill', requirement: 'Deal 1,000 or more damage to a minion in one hit.', metric: 'hitDamageMax', target: 1_000, xp: 400 },
  { key: 'glass_cannon', requirement: 'Win a combat with 4 or more minions that all began it on 1 Health.', metric: 'glassCannonWin', target: 1, xp: 300 },
  { key: 'brick_wall', requirement: 'Have your Wards block 30 hits in one combat.', metric: 'wardBlocksCombatMax', target: 30, xp: 500 },
  { key: 'echo_chamber', requirement: 'Trigger 100 Echoes in one combat.', metric: 'echoTriggersCombatMax', target: 100, xp: 600 },
  { key: 'hype_man', requirement: 'Trigger 50 Rallies in one combat.', metric: 'ralliesCombatMax', target: 50, xp: 500 },
  { key: 'unkillable', requirement: 'Have one minion live through 15 attacks in one combat.', metric: 'attacksSurvivedMax', target: 15, xp: 450 },
  { key: 'shouting_match', requirement: 'Trigger 75 Shouts in one turn.', metric: 'shoutsTurnMax', target: 75, xp: 500 },
  { key: 'absolute_unit', requirement: 'Have a minion with 2,500 Attack and 2,500 Health on your board.', metric: 'minionStatsMinMax', target: 2_500, xp: 500 },
  { key: 'gym_rat', requirement: 'Give one minion 250 separate permanent buffs.', metric: 'buffsOnOneMax', target: 250, xp: 500 },
  // Royal (lobby and placement)
  { key: 'mixed_company', requirement: 'Finish 1st in Ranked with 5 tribes on your final board and no tribe more than twice.', metric: 'finalTribesSpread', target: 5, xp: 400, mode: 'ranked', placementMax: 1 },
  { key: 'cockroach', requirement: 'End 5 rounds alive on exactly 1 Health, and finish Top 4.', metric: 'oneHealthRounds', target: 5, xp: 600, placementMax: 4 },
  { key: 'never_bested', requirement: 'Finish 1st in Ranked winning every single combat.', metric: 'perfectRecord', target: 1, xp: 750, mode: 'ranked', placementMax: 1 },
  { key: 'the_untouchable', requirement: 'Finish 1st in Ranked without losing any Health. Armor may break.', metric: 'fullHealthFinish', target: 1, xp: 750, mode: 'ranked', placementMax: 1 },
  { key: 'regicide', requirement: 'Deal more than 40 damage to an opponent in one fight.', metric: 'heroDamageCombatMax', target: 41, xp: 500 },
  { key: 'headsman', requirement: 'Knock out a player in 4 rounds in a row.', metric: 'knockoutStreakMax', target: 4, xp: 600 },
  { key: 'fashionably_late', requirement: 'Finish 1st in Ranked after having the least Health at the table after round 10.', metric: 'lastAtRound10', target: 1, xp: 600, mode: 'ranked', placementMax: 1 },
  { key: 'photo_finish', requirement: 'Finish 1st in Ranked by knocking out your last opponent with exactly lethal damage.', metric: 'exactLethalFinish', target: 1, xp: 400, mode: 'ranked', placementMax: 1 },
  // Jester (silly)
  { key: 'agree_to_disagree', requirement: 'Tie 3 combats in one game.', metric: 'combatDraws', target: 3, xp: 250 },
  { key: 'committed_to_the_bit', requirement: 'Finish 1st in Ranked with 7 copies of the same minion on your final board.', metric: 'finalSameCardMax', target: 7, xp: 600, mode: 'ranked', placementMax: 1 },
  { key: 'tier_one_hero', requirement: 'Finish 1st in Ranked with 7 minions on your final board, all of them Tier 1.', metric: 'finalTierOneOnly', target: 7, xp: 750, mode: 'ranked', placementMax: 1 },
  { key: 'empty_handed', requirement: 'Win a combat you began with an empty board.', metric: 'emptyBoardWin', target: 1, xp: 400 },
  { key: 'pacifist', requirement: 'Win a combat without any of your minions attacking.', metric: 'pacifistWin', target: 1, xp: 350 },
  { key: 'hoarder', requirement: 'End every turn from round 5 to the end of the game with a full hand.', metric: 'fullHandFrom5', target: 1, xp: 350 },
];
const SECRET_NAME_OF: ReadonlyMap<string, string> = new Map(SECRET_TITLE_NAMES);
/** The secret feats, in display order (the Secrets category). Hidden until completed; each grants its own title. */
export const SECRET_ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze(SECRET_FEATS.map((f) => def({
  id: secretAchievementId(f.key), name: SECRET_NAME_OF.get(f.key) ?? f.key, requirement: f.requirement, category: 'secret',
  mode: f.mode ?? 'any', placementMax: f.placementMax ?? null, metric: f.metric, target: f.target, xp: f.xp,
  titleId: secretTitleId(f.key), hidden: true, showProgress: false,
})));

/**
 * TRIBES AND MECHANICS (owner 2026-11-20: "come up with another 100 achievements to add as well across tribes and
 * mechanics"). 100 VISIBLE defs, XP only (no titles, no cosmetics): 50 in the new Tribes category (8 tribes, no Mech,
 * set-agnostic so a tribe's feats count in whichever set it is played), 50 across the mechanic families, placed in the
 * existing category they belong to. Every one reads a RUN metric the observer counts (achievementMetrics.ts) or the
 * server's `game`; 24 run metrics are new (the TRIBES AND MECHANICS block in RUN_METRICS). None duplicates an existing
 * achievement's predicate (metric, aggregation, target, mode, placement, set): pinned in achievements.test.ts.
 * Spirit and Undead feats need Set 3, Celestial ones Set 4: neither set is live, so they wait, exactly like the
 * Spirit, Undead and Celestial secret titles do.
 */
const tr = (group: (typeof TRIBE_GROUPS)[number], d: Omit<DefInput, 'category' | 'group' | 'mode'> & { mode?: AchievementMode }): AchievementDef =>
  def({ mode: 'any', ...d, category: 'tribes', group });
/** One of each per tribe: a lifetime play count and a 500 Attack minion. */
const TRIBE_COMMON: ReadonlyArray<{ group: (typeof TRIBE_GROUPS)[number]; one: string; many: string; plays: RunMetric; attack: RunMetric; playsName: string; attackName: string }> = [
  { group: 'dwarf', one: 'a Dwarf', many: 'Dwarves', plays: 'dwarfPlays', attack: 'dwarfAttackMax', playsName: 'Stout Company', attackName: 'Rock Hard' },
  { group: 'demon', one: 'a Demon', many: 'Demons', plays: 'demonPlays', attack: 'demonAttackMax', playsName: "Hell's Kitchen", attackName: 'Horns Up' },
  { group: 'spirit', one: 'a Spirit', many: 'Spirits', plays: 'spiritPlays', attack: 'spiritAttackMax', playsName: 'Seance', attackName: 'Big Boo' },
  { group: 'dragon', one: 'a Dragon', many: 'Dragons', plays: 'dragonPlays', attack: 'dragonAttackMax', playsName: 'Wyrm Herder', attackName: 'Scaly Bruiser' },
  { group: 'beast', one: 'a Beast', many: 'Beasts', plays: 'beastPlays', attack: 'beastAttackMax', playsName: 'Animal House', attackName: 'Top Dog' },
  { group: 'undead', one: 'an Undead', many: 'Undead', plays: 'undeadPlays', attack: 'undeadAttackMax', playsName: 'Grave Digger', attackName: 'Bad to the Bone' },
  { group: 'kobold', one: 'a Kobold', many: 'Kobolds', plays: 'koboldPlays', attack: 'koboldAttackMax', playsName: 'Tunnel Vision', attackName: 'Pocket Rocket' },
  { group: 'celestial', one: 'a Celestial', many: 'Celestials', plays: 'celestialPlays', attack: 'celestialAttackMax', playsName: 'Star Power', attackName: 'Shooting Star' },
];
const TRIBE_SIGNATURE: AchievementDef[] = [
  // Dwarves: Ales, Gold, damage
  tr('dwarf', { id: 'tribe.dwarf.ales_game_40', name: 'Pub Crawl', requirement: 'Cast 40 Dwarven Ales in one game.', metric: 'alesCast', target: 40, xp: 300 }),
  tr('dwarf', { id: 'tribe.dwarf.damage_life_50000', name: 'Rock and Stone', requirement: 'Have your Dwarves deal 50,000 damage across all your games.', metric: 'dwarfDamage', agg: 'sum', target: 50_000, xp: 400 }),
  tr('dwarf', { id: 'tribe.dwarf.hall_spend_80', name: 'Running a Tab', requirement: 'Spend 80 Gold in one turn with 5 or more Dwarves on your board.', metric: 'dwarfHallSpendTurnMax', target: 80, xp: 350 }),
  tr('dwarf', { id: 'tribe.dwarf.banked_10', name: 'Tip Jar', requirement: 'Bank 10 Gold for next turn during one combat.', metric: 'combatGoldMax', target: 10, xp: 250 }),
  // Demons: Imps, consume
  tr('demon', { id: 'tribe.demon.imps_life_1000', name: 'Imp Factory', requirement: 'Summon 1,000 Imps in combat across all your games.', metric: 'impSummons', agg: 'sum', target: 1_000, xp: 400 }),
  tr('demon', { id: 'tribe.demon.consumes_game_50', name: 'Second Helping', requirement: 'Consume 50 Shop minions in one game.', metric: 'consumes', target: 50, xp: 350 }),
  tr('demon', { id: 'tribe.demon.damage_combat_1500', name: "Devil's Due", requirement: 'Have your Demons deal 1,500 damage to enemy minions in one combat.', metric: 'demonDamageCombatMax', target: 1_500, xp: 300 }),
  tr('demon', { id: 'tribe.demon.consumed_500', name: 'Eyes Bigger Than Stomach', requirement: 'Consume a Shop minion with 500 or more total Attack and Health.', metric: 'consumedStatsMax', target: 500, xp: 450 }),
  // Spirits (Set 3): summons from hand, Revelers
  tr('spirit', { id: 'tribe.spirit.hand_summons_8', name: 'Out of Thin Air', requirement: 'Summon 8 minions from your hand in one combat.', metric: 'handSummonsCombatMax', target: 8, xp: 300 }),
  tr('spirit', { id: 'tribe.spirit.hand_summons_life_250', name: 'Sleight of Hand', requirement: 'Summon 250 minions from your hand in combat across all your games.', metric: 'handSummons', agg: 'sum', target: 250, xp: 400 }),
  tr('spirit', { id: 'tribe.spirit.revelers_life_100', name: 'After Party', requirement: 'Sell 100 Revelers across all your games.', metric: 'revelerSells', agg: 'sum', target: 100, xp: 300 }),
  tr('spirit', { id: 'tribe.spirit.win_banner', name: 'Haunted House', requirement: 'Finish 1st in Ranked with 5 Spirits on your final board.', mode: 'ranked', metric: 'finalSpirits', placementMax: 1, target: 5, xp: 150 }),
  // Dragons: Shouts, spell power, Dragonflame
  tr('dragon', { id: 'tribe.dragon.shouts_15', name: 'Hot Air', requirement: 'Trigger 15 Shouts in one turn with 3 or more Dragons on your board.', metric: 'dragonShoutsTurnMax', target: 15, xp: 300 }),
  tr('dragon', { id: 'tribe.dragon.spell_power_20', name: 'Book Smart', requirement: 'Raise your spell power to +20 Attack or +20 Health.', metric: 'spellPower', target: 20, xp: 550 }),
  tr('dragon', { id: 'tribe.dragon.dragonflame_150', name: 'Scorched Earth', requirement: 'In combat, have one Dragonflame give a minion +150/+150 or more.', metric: 'dragonflameMax', target: 150, xp: 450 }),
  tr('dragon', { id: 'tribe.dragon.plays_game_40', name: 'Flight School', requirement: 'Play 40 Dragons in one game.', metric: 'dragonPlays', target: 40, xp: 300 }),
  // Beasts: Echo, summons, King Oona
  tr('beast', { id: 'tribe.beast.echoes_20', name: 'Howling Pack', requirement: 'Trigger 20 Beast Echoes in one combat.', metric: 'beastEchoesCombatMax', target: 20, xp: 450 }),
  tr('beast', { id: 'tribe.beast.royal_500', name: 'Big Game', requirement: 'With King Oona on your board, summon a Beast with 500 or more total Attack and Health in combat.', metric: 'oonaBeastSummonMax', target: 500, xp: 450 }),
  tr('beast', { id: 'tribe.beast.summons_life_1000', name: 'Breeding Season', requirement: 'Summon 1,000 Beasts in combat across all your games.', metric: 'beastSummons', agg: 'sum', target: 1_000, xp: 400 }),
  tr('beast', { id: 'tribe.beast.gilded_4', name: 'Best in Show', requirement: 'Have 4 Gilded Beasts on your board at once.', metric: 'beastGildedMax', target: 4, xp: 250 }),
  // Undead (Set 3): Rise, Skeletons
  tr('undead', { id: 'tribe.undead.rises_game_25', name: 'Rise and Shine', requirement: 'Have your Undead Rise 25 times in combat in one game.', metric: 'undeadRises', target: 25, xp: 300 }),
  tr('undead', { id: 'tribe.undead.rises_life_500', name: 'Restless Dead', requirement: 'Have your Undead Rise 500 times in combat across all your games.', metric: 'undeadRises', agg: 'sum', target: 500, xp: 400 }),
  tr('undead', { id: 'tribe.undead.rises_combat_6', name: 'Second Wind', requirement: 'Have your Undead Rise 6 times in one combat.', metric: 'undeadRisesCombatMax', target: 6, xp: 250 }),
  tr('undead', { id: 'tribe.undead.skeletons_10', name: 'Bag of Bones', requirement: 'Summon 10 Skeletons in one combat.', metric: 'skeletonSummonsCombatMax', target: 10, xp: 250 }),
  tr('undead', { id: 'tribe.undead.win_banner', name: 'Crypt Keeper', requirement: 'Finish 1st in Ranked with 5 Undead on your final board.', mode: 'ranked', metric: 'finalUndead', placementMax: 1, target: 5, xp: 150 }),
  // Kobolds: Rubies, the Golem, Kobebes
  tr('kobold', { id: 'tribe.kobold.rubies_turn_20', name: 'Gem Rush', requirement: 'Play 20 Rubies in one turn.', metric: 'rubyPlaysTurnMax', target: 20, xp: 400 }),
  tr('kobold', { id: 'tribe.kobold.ruby_strength_20', name: 'Rock Solid', requirement: 'Raise your Rubies to a +20/+20 bonus in one game.', metric: 'rubyStrength', target: 20, xp: 550 }),
  tr('kobold', { id: 'tribe.kobold.golem_300', name: 'Gem Giant', requirement: 'Summon a Gemheart Golem with 300 or more total Attack and Health in combat.', metric: 'golemStatsCombatMax', target: 300, xp: 400 }),
  tr('kobold', { id: 'tribe.kobold.rubies_landed_40', name: 'Gem Rain', requirement: 'Have 40 Rubies land on your minions in one combat.', metric: 'rubiesLandedCombatMax', target: 40, xp: 350 }),
  tr('kobold', { id: 'tribe.kobold.kobebes_3', name: 'Daycare', requirement: 'Have 3 Kobebes on your board at once.', metric: 'kobebesMax', target: 3, xp: 200 }),
  // Celestials (Set 4): Starform, Shop spells
  tr('celestial', { id: 'tribe.celestial.starform_50', name: 'Stardust', requirement: 'Grow a Starform to 50 Attack in the Shop.', metric: 'starformAttackMax', target: 50, xp: 250 }),
  tr('celestial', { id: 'tribe.celestial.spells_10', name: 'Star Chart', requirement: 'Cast 10 Shop spells in one turn with 3 or more Celestials on your board.', metric: 'celestialSpellsTurnMax', target: 10, xp: 300 }),
  tr('celestial', { id: 'tribe.celestial.gilded_4', name: 'Star Studded', requirement: 'Have 4 Gilded Celestials on your board at once.', metric: 'celestialGildedMax', target: 4, xp: 250 }),
  tr('celestial', { id: 'tribe.celestial.win_banner', name: 'Constellation', requirement: 'Finish 1st in Ranked with 5 Celestials on your final board.', mode: 'ranked', metric: 'finalCelestials', placementMax: 1, target: 5, xp: 150 }),
];
const TRIBES: AchievementDef[] = TRIBE_GROUPS.flatMap((g) => {
  const c = TRIBE_COMMON.find((x) => x.group === g)!;
  return [
    tr(g, { id: `tribe.${g}.plays_1000`, family: 'tribe.plays', name: c.playsName, requirement: `Play 1,000 ${c.many} across all your games.`, metric: c.plays, agg: 'sum', target: 1_000, xp: 300 }),
    tr(g, { id: `tribe.${g}.attack_500`, family: 'tribe.attack', name: c.attackName, requirement: `Have ${c.one} with 500 Attack on your board.`, metric: c.attack, target: 500, xp: 300 }),
    ...TRIBE_SIGNATURE.filter((a) => a.group === g),
  ];
});

const mech = (category: AchievementCategory, d: Omit<DefInput, 'category' | 'mode'> & { mode?: AchievementMode }): AchievementDef =>
  def({ mode: 'any', ...d, category, ...(category === 'heroes' ? { group: HEROES_ALL_GROUP } : {}) });
const MECHANIC_FAMILIES: AchievementDef[] = [
  // Echo, Rally, Shout, Ward, Execute, Pummel, Start of Combat, End of Turn
  mech('mechanics', { id: 'mechanic.echo_triggers_40', name: 'Encore', requirement: 'Trigger 40 Echoes in one combat.', metric: 'echoTriggersCombatMax', target: 40, xp: 350 }),
  mech('mechanics', { id: 'mechanic.echo_triggers_life_2000', name: 'Broken Record', requirement: 'Trigger 2,000 Echoes across all your games.', metric: 'echoTriggers', agg: 'sum', target: 2_000, xp: 400 }),
  mech('mechanics', { id: 'mechanic.rallies_20', name: 'Pep Rally', requirement: 'Trigger 20 Rallies in one combat.', metric: 'ralliesCombatMax', target: 20, xp: 300 }),
  mech('mechanics', { id: 'mechanic.rallies_life_1000', name: 'Cheerleader', requirement: 'Trigger 1,000 Rallies across all your games.', metric: 'rallies', agg: 'sum', target: 1_000, xp: 400 }),
  mech('mechanics', { id: 'mechanic.shouts_turn_25', name: 'Shout It Out', requirement: 'Trigger 25 Shouts in one turn.', metric: 'shoutsTurnMax', target: 25, xp: 300 }),
  mech('mechanics', { id: 'mechanic.shouts_life_2500', name: 'Loud and Proud', requirement: 'Trigger 2,500 Shouts across all your games.', metric: 'shouts', agg: 'sum', target: 2_500, xp: 400 }),
  mech('mechanics', { id: 'mechanic.ward_blocks_20', name: 'Bubble Wrap', requirement: 'Have your Wards block 20 hits in one combat.', metric: 'wardBlocksCombatMax', target: 20, xp: 400 }),
  mech('mechanics', { id: 'mechanic.ward_blocks_life_500', name: 'Safety First', requirement: 'Have your Wards block 500 hits across all your games.', metric: 'wardBlocks', agg: 'sum', target: 500, xp: 300 }),
  mech('mechanics', { id: 'mechanic.execute_7', name: 'Lethal Dose', requirement: 'Destroy 7 enemy minions with Execute in one combat.', metric: 'executeKillsCombatMax', target: 7, xp: 450 }),
  mech('mechanics', { id: 'mechanic.execute_life_200', name: 'Toxic Waste', requirement: 'Destroy 200 enemy minions with Execute across all your games.', metric: 'executeKills', agg: 'sum', target: 200, xp: 400 }),
  mech('mechanics', { id: 'mechanic.pummel_5', name: 'Pummeled', requirement: 'Have Pummel pay out 5 times in one combat.', metric: 'pummelsCombatMax', target: 5, xp: 300 }),
  mech('mechanics', { id: 'mechanic.pummel_life_250', name: 'Punching Bag', requirement: 'Have Pummel pay out 250 times across all your games.', metric: 'pummels', agg: 'sum', target: 250, xp: 400 }),
  mech('mechanics', { id: 'mechanic.opening_kills_3', name: 'Opening Salvo', requirement: 'Destroy 3 enemy minions before the first attack of a combat.', metric: 'openingKillsCombatMax', target: 3, xp: 350 }),
  mech('mechanics', { id: 'mechanic.end_turn_20', name: 'Late Shift', requirement: 'Trigger 20 End of Turn effects in one turn.', metric: 'eotFiresMax', target: 20, xp: 350 }),
  mech('mechanics', { id: 'mechanic.end_turn_life_1500', name: 'Clock Watcher', requirement: 'Trigger 1,500 End of Turn effects across all your games.', metric: 'eotFires', agg: 'sum', target: 1_500, xp: 400 }),
  // Discover, Choose One
  mech('mechanics', { id: 'mechanic.discovers_20', name: 'Spoiled for Choice', requirement: 'Discover 20 cards in one game.', metric: 'discovers', target: 20, xp: 300 }),
  mech('mechanics', { id: 'mechanic.discovers_life_500', name: 'Treasure Hunter', requirement: 'Discover 500 cards across all your games.', metric: 'discovers', agg: 'sum', target: 500, xp: 400 }),
  mech('mechanics', { id: 'mechanic.choose_one_15', name: 'Decisions, Decisions', requirement: 'Make 15 Choose One picks in one game.', metric: 'chooseOnes', target: 15, xp: 300 }),
  mech('mechanics', { id: 'mechanic.choose_one_life_250', name: 'Fork in the Road', requirement: 'Make 250 Choose One picks across all your games.', metric: 'chooseOnes', agg: 'sum', target: 250, xp: 400 }),
  // Spells
  mech('mechanics', { id: 'mechanic.spells_game_100', name: 'Spell Check', requirement: 'Cast 100 Shop spells in one game. Rubies do not count.', metric: 'spellsCast', target: 100, xp: 400 }),
  mech('mechanics', { id: 'mechanic.spells_turn_20', name: 'Spell Spam', requirement: 'Cast 20 Shop spells in one turn. Rubies do not count.', metric: 'spellsTurnMax', target: 20, xp: 400 }),
  mech('mechanics', { id: 'mechanic.spell_buffs_life_5000', name: 'Abracadabra', requirement: 'Buff minions with spells 5,000 times across all your games. Each buff on each minion counts.', metric: 'spellBuffs', agg: 'sum', target: 5_000, xp: 400 }),
  // Gilding, Freeze, Refresh, Selling, Gold, tiering
  mech('economy', { id: 'economy.gilds_game_10', name: 'Triple Trouble', requirement: 'Gild 10 minions in one game.', metric: 'gildsMade', target: 10, xp: 350 }),
  mech('economy', { id: 'economy.gilded_board_5', name: 'Shiny Things', requirement: 'Have 5 Gilded minions on your board at once.', metric: 'gildedOnBoardMax', target: 5, xp: 300 }),
  mech('economy', { id: 'economy.frozen_buys_5', name: 'Deep Freeze', requirement: 'Buy 5 cards in one turn from a Shop you froze last turn.', metric: 'frozenBuysTurnMax', target: 5, xp: 250 }),
  mech('economy', { id: 'economy.freezes_game_8', name: 'Cold Storage', requirement: 'Freeze the Shop on 8 different turns of one game.', metric: 'freezes', target: 8, xp: 250 }),
  mech('economy', { id: 'economy.refresh_turn_20', name: 'Reroll Addict', requirement: 'Refresh the Shop 20 times in one turn.', metric: 'refreshesTurnMax', target: 20, xp: 250 }),
  mech('economy', { id: 'economy.refreshes_life_2500', name: 'Slot Machine', requirement: 'Refresh the Shop 2,500 times across all your games.', metric: 'refreshes', agg: 'sum', target: 2_500, xp: 400 }),
  mech('economy', { id: 'economy.sell_turn_12', name: 'Fire Sale', requirement: 'Sell 12 minions in one turn.', metric: 'sellsTurnMax', target: 12, xp: 250 }),
  mech('economy', { id: 'economy.sells_life_1000', name: 'Pawn Shop', requirement: 'Sell 1,000 minions across all your games.', metric: 'sells', agg: 'sum', target: 1_000, xp: 300 }),
  mech('economy', { id: 'economy.spend_turn_40', name: 'Splurge', requirement: 'Spend 40 Gold in one turn.', metric: 'goldSpentTurnMax', target: 40, xp: 200 }),
  mech('economy', { id: 'economy.spend_game_300', name: 'Shopaholic', requirement: 'Spend 300 Gold in one game.', metric: 'goldSpent', target: 300, xp: 350 }),
  mech('economy', { id: 'economy.turn_start_25', name: 'Rainy Day Fund', requirement: 'Start a turn with 25 Gold.', metric: 'goldTurnStartMax', target: 25, xp: 250 }),
  mech('economy', { id: 'economy.discount_life_250', name: 'Coupon Clipper', requirement: 'Buy 250 discounted minions across all your games.', metric: 'discountBuys', agg: 'sum', target: 250, xp: 300 }),
  mech('economy', { id: 'shop.low_tier_top_four', name: 'Bargain Bin', requirement: 'Finish Top 4 without ever going past Shop Tier 3.', metric: 'lowTierGame', placementMax: 4, target: 1, xp: 300 }),
  mech('economy', { id: 'shop.tier_six_early_10', name: 'Express Lane', requirement: 'Reach Shop Tier 6 by round 9 in 10 different games.', metric: 'tierSixByRound9', agg: 'sum', target: 10, xp: 300 }),
  // Runes and the Runeforge
  mech('runes', { id: 'rune.triggers_100', family: 'rune.triggers', name: 'Rune Rush', requirement: 'Have your Runes trigger 100 times in one game.', metric: 'runeTriggers', target: 100, xp: 400 }),
  mech('runes', { id: 'rune.five_engines', name: 'Engine Room', requirement: 'Have 5 different Runes each trigger 5 times in one game.', metric: 'runesFivePlus', target: 5, xp: 350 }),
  mech('runes', { id: 'rune.tribal_pair_win', name: 'Matching Set', requirement: 'Finish 1st in Ranked holding a Basic and an Epic Rune of the same tribe.', mode: 'ranked', metric: 'tribalRunePair', placementMax: 1, target: 1, xp: 300 }),
  mech('runes', { id: 'rune.epic_lifetime_100', name: 'Epic Saga', requirement: 'Forge 100 Epic Runes across all your games.', metric: 'epicRunesForged', agg: 'sum', target: 100, xp: 600 }),
  // Hero powers
  mech('heroes', { id: 'hero.power_uses_game_20', name: 'Button Masher', requirement: 'Use your hero power 20 times in one game.', metric: 'heroPowerUses', target: 20, xp: 250 }),
  // Armor and Health, knockouts, big hits, lobby placement
  mech('combat', { id: 'combat.full_health_top_four', name: 'Not a Scratch', requirement: 'Finish Top 4 without losing any Health. Armor may break.', metric: 'fullHealthFinish', placementMax: 4, target: 1, xp: 350 }),
  mech('combat', { id: 'combat.brink_top_four_10', family: 'combat.brink', name: 'Nine Lives', requirement: 'Finish Top 4 after falling to 5 or less Health in 10 games.', metric: 'brink', agg: 'sum', placementMax: 4, target: 10, xp: 400 }),
  mech('combat', { id: 'combat.one_health_rounds_10', name: 'Living on the Edge', requirement: 'End 10 rounds alive on exactly 1 Health and no Armor, across all your games.', metric: 'oneHealthRounds', agg: 'sum', target: 10, xp: 300 }),
  mech('combat', { id: 'combat.knockout_streak_2', name: 'Double Tap', requirement: 'Knock out a player in 2 rounds in a row.', metric: 'knockoutStreakMax', target: 2, xp: 250 }),
  mech('combat', { id: 'combat.kills_game_60', name: 'Body Count', requirement: 'Destroy 60 enemy minions in one game.', metric: 'enemyKills', target: 60, xp: 300 }),
  mech('combat', { id: 'combat.hit_300', name: 'Haymaker', requirement: 'Deal 300 or more damage to a minion in one hit.', metric: 'hitDamageMax', target: 300, xp: 250 }),
  mech('combat', { id: 'combat.minion_500', name: 'Built Different', requirement: 'Have a minion with 500 Attack and 500 Health on your board.', metric: 'minionStatsMinMax', target: 500, xp: 300 }),
  mech('career', { id: 'career.final_two.10', family: 'career.final_two', name: 'Runner Up', requirement: 'Finish in the final 2 in 10 Ranked games.', mode: 'ranked', metric: 'game', agg: 'sum', placementMax: 2, target: 10, xp: 200, trust: 'S' }),
  mech('career', { id: 'career.final_two.50', family: 'career.final_two', name: 'Heads Up', requirement: 'Finish in the final 2 in 50 Ranked games.', mode: 'ranked', metric: 'game', agg: 'sum', placementMax: 2, target: 50, xp: 500, trust: 'S' }),
];
/** The 100 added 2026-11-20 (tribes and mechanics), in display order. Visible, XP only. */
export const ACHIEVEMENTS_TRIBES_MECHANICS: readonly AchievementDef[] = Object.freeze([...TRIBES, ...MECHANIC_FAMILIES]);

/** The 150 added 2026-10-03, in display order. */
export const ACHIEVEMENTS_150: readonly AchievementDef[] = Object.freeze([...SET2_MORE, ...HERO_DEVOTED, ...HEROES_ALL, ...COMBAT, ...MILESTONES]);

/** Every achievement in the game (batch 1 plus the 2026-10-03 150). Order is display order within a category. */
export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([...CAREER, ...RANKED, ...HERO_ACHIEVEMENTS, ...ECONOMY, ...MECHANICS, ...RUNES, ...SET2, ...ACHIEVEMENTS_150, ...ACHIEVEMENTS_TRIBES_MECHANICS, ...COLLECTION, ...SECRET_ACHIEVEMENTS]);

export const ACHIEVEMENT_INDEX: Readonly<Record<string, AchievementDef>> = Object.freeze(Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a])));
export const achievementOf = (id: string | null | undefined): AchievementDef | null => (id && ACHIEVEMENT_INDEX[id] ? ACHIEVEMENT_INDEX[id]! : null);

/** The XP a set of completed ids paid (unknown ids pay nothing). */
export const achievementXpOf = (ids: readonly string[]): number => ids.reduce((s, id) => s + (achievementOf(id)?.rewards.xp ?? 0), 0);

// ── The evaluator (the TS mirror of the SQL in settle_progression) ──────────────────────────────────────────

/** Everything the evaluator needs about ONE settlement. */
export interface AchievementSettlement {
  mode: ProgressionMode;
  /** Ranked, or a standard Practice (Normal Health AND a turn timer): the `any` gate. */
  eligibleRun: boolean;
  setId: string | null;
  heroId: string | null;
  /** The server's placement (null: none). */
  placement: number | null;
  /** Run metrics (sanitized) merged with the server metrics, except `achievementsCompleted` (the evaluator counts it). */
  metrics: Readonly<Record<string, number>>;
}

export interface AchievementProgressRow { progress: number; completed: boolean }

export interface AchievementEvaluation {
  /** New progress per achievement this settlement moved (completed ones included). */
  progress: Record<string, number>;
  /** Ids completed by THIS settlement, in evaluation order. */
  completed: string[];
  /** Their XP total. */
  xp: number;
}

/** Does this settlement pass the def's gates (mode, set, hero, placement)? */
export function achievementGatePasses(d: Pick<AchievementDef, 'mode' | 'setId' | 'heroId' | 'placementMax'>, s: Pick<AchievementSettlement, 'mode' | 'eligibleRun' | 'setId' | 'heroId' | 'placement'>): boolean {
  if (d.mode === 'ranked' && s.mode !== 'ranked') return false;
  if (d.mode === 'tutorial' && s.mode !== 'tutorial') return false;
  if (d.mode === 'any' && !s.eligibleRun) return false;
  if (d.setId !== null && s.setId !== d.setId) return false;
  if (d.heroId !== null && s.heroId !== d.heroId) return false;
  if (d.placementMax !== null && (s.placement === null || s.placement > d.placementMax)) return false;
  return true;
}

/**
 * Evaluate every def against one settlement (the SQL does the same, in the same order: every non-meta def by id,
 * then the meta family by target). `prior` = the account's stored progress. Pure.
 */
export function evaluateAchievements(
  defs: readonly AchievementDef[], s: AchievementSettlement, prior: Readonly<Record<string, AchievementProgressRow>>,
): AchievementEvaluation {
  const out: AchievementEvaluation = { progress: {}, completed: [], xp: 0 };
  let completedCount = Object.values(prior).filter((p) => p.completed).length;
  const step = (d: AchievementDef, value: number): void => {
    const p = prior[d.id];
    if (p?.completed || !(value > 0) || !achievementGatePasses(d, s)) return;
    const old = p?.progress ?? 0;
    const next = d.agg === 'sum' ? old + value : Math.max(old, value);
    if (next === old && next < d.target) return;
    out.progress[d.id] = next;
    if (next >= d.target) {
      out.completed.push(d.id);
      out.xp += d.rewards.xp;
      completedCount++;
    }
  };
  const byId = (a: AchievementDef, b: AchievementDef): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const d of defs.filter((x) => x.metric !== META_METRIC).sort(byId)) step(d, Math.trunc(s.metrics[d.metric] ?? 0));
  for (const d of defs.filter((x) => x.metric === META_METRIC).sort((a, b) => a.target - b.target || byId(a, b))) step(d, completedCount);
  return out;
}

// ── The catalog the database holds (written by `sync_achievement_catalog`) ──────────────────────────────────

export interface AchievementCatalogRow {
  achievementId: string;
  version: number;
  category: string;
  mode: AchievementMode;
  setId: string | null;
  heroId: string | null;
  placementMax: number | null;
  metric: string;
  agg: AchievementAgg;
  target: number;
  xp: number;
  titleId: string | null;
  hidden: boolean;
  trust: AchievementTrust;
  active: boolean;
}
export interface AchievementCatalogPayload { version: 1; items: AchievementCatalogRow[] }

/** The rows `sync_achievement_catalog` writes (camelCase keys; batch 1 only, prestige never active yet). */
export function achievementCatalogPayload(defs: readonly AchievementDef[] = ACHIEVEMENTS): AchievementCatalogPayload {
  return {
    version: 1,
    items: defs.map((d) => ({
      achievementId: d.id, version: d.version, category: d.category, mode: d.mode, setId: d.setId, heroId: d.heroId,
      placementMax: d.placementMax, metric: d.metric, agg: d.agg, target: d.target, xp: d.rewards.xp, titleId: d.rewards.titleId,
      hidden: d.hidden, trust: d.trust, active: d.batch === 1 && d.trust !== 'P',
    })).sort((a, b) => (a.achievementId < b.achievementId ? -1 : a.achievementId > b.achievementId ? 1 : 0)),
  };
}

/** A stable content hash of the payload (the sync short-circuits on an unchanged catalog). */
export function achievementCatalogHash(payload: AchievementCatalogPayload): string {
  const s = JSON.stringify(payload);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `a1-${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}
