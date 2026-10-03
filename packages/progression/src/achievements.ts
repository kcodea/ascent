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
 * (the Career tab blurs it as "Hidden") but no hidden entry ships yet.
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
import type { ProgressionMode } from './rules';
import { heroMasterTitleId, heroTitleId } from './cosmetics';

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
  menagerieRuneFinalTribes: { cap: 20, doc: 'Final-board tribes when holding Rune of the Menagerie (0 without it).' },
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
  overtimeProcs: { cap: 10_000, doc: 'Rune of Overtime payouts this game.' },
  blartProcs: { cap: 10_000, doc: 'Rune of Blart payouts this game.' },
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
export type AchievementMetric = RunMetric | ServerMetric;
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

export const ACHIEVEMENT_CATEGORIES = ['career', 'ranked', 'heroes', 'economy', 'mechanics', 'runes', 'set2', 'combat', 'milestones'] as const;
export type AchievementCategory = typeof ACHIEVEMENT_CATEGORIES[number];
export const ACHIEVEMENT_CATEGORY_LABELS: Readonly<Record<AchievementCategory, string>> = Object.freeze({
  career: 'Career', ranked: 'Ranked', heroes: 'Heroes', economy: 'Economy and Build', mechanics: 'Mechanics', runes: 'Runes', set2: 'Set 2',
  combat: 'Combat', milestones: 'Milestones',
});

/** Sub-groups (the Set 2 tribes; the others use one group). */
export const SET2_GROUPS = ['kobold', 'dwarf', 'dragon', 'beast', 'demon', 'cross', 'rune'] as const;
export const ACHIEVEMENT_GROUP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  kobold: 'Kobolds', dwarf: 'Dwarves', dragon: 'Dragons', beast: 'Beasts', demon: 'Demons', cross: 'Cross-tribe', rune: 'Runes',
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

/** What completing pays. `titleId` is the reserved slot for a title reward (null for every batch 1 def). */
export interface AchievementRewards { xp: number; titleId: string | null }

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
  & { xp: number; titleId?: string | null };

function def(d: DefInput): AchievementDef {
  const { xp, titleId, ...rest } = d;
  const agg = d.agg ?? 'max';
  return {
    version: 1, group: null, family: null, setId: null, heroId: null, placementMax: null, hidden: false, trust: 'O', batch: 1,
    showProgress: d.showProgress ?? (d.target > 1 && (agg === 'sum' || d.metric === 'heroesPlayed' || d.metric === 'heroesWon' || d.metric === 'achievementsCompleted' || d.metric === 'firstStreak' || d.metric === 'topFourStreak')),
    ...rest,
    agg,
    rewards: { xp, titleId: titleId ?? null },
  };
}

// Career ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CAREER: AchievementDef[] = [
  def({ id: 'tutorial.complete_course', name: 'Ready to Ascend', requirement: 'Complete the Learn Ascent course.', category: 'career', mode: 'tutorial', metric: 'game', target: 1, xp: 100, trust: 'S' }),
  ...([[1, 'First Steps', 25], [10, 'Regular', 50], [50, 'Seasoned', 75], [100, 'Veteran', 100]] as const).map(([n, name, xp]) => def({
    id: `career.games.${n}`, name, requirement: n === 1 ? 'Complete a game.' : `Complete ${n} games.`, category: 'career', family: 'career.games',
    mode: 'any', metric: 'game', agg: 'sum', target: n, xp, trust: 'S',
  })),
  ...([[10, 'Contender', 50], [50, 'Mainstay', 100]] as const).map(([n, name, xp]) => def({
    id: `career.top_four.${n}`, name, requirement: `Finish Top 4 in ${n} Ranked games.`, category: 'career', family: 'career.top_four',
    mode: 'ranked', metric: 'game', agg: 'sum', placementMax: 4, target: n, xp, trust: 'S',
  })),
  ...([[5, 'Victor', 100], [25, 'Conqueror', 200]] as const).map(([n, name, xp]) => def({
    id: `career.firsts.${n}`, name, requirement: `Finish 1st in ${n} Ranked games.`, category: 'career', family: 'career.firsts',
    mode: 'ranked', metric: 'game', agg: 'sum', placementMax: 1, target: n, xp, trust: 'S',
  })),
  ...([[1, 'Never Out', 50], [10, 'Back from the Brink', 100]] as const).map(([n, name, xp]) => def({
    id: `career.comebacks.${n}`, name, requirement: n === 1 ? 'Earn the comeback bonus: win a combat right after 4 losses in a row.' : `Earn the comeback bonus ${n} times.`,
    category: 'career', family: 'career.comebacks', mode: 'any', metric: 'comeback', agg: 'sum', target: n, xp, trust: 'S',
  })),
  ...([[5, 'Well Traveled', 50], [15, 'Many Faces', 100]] as const).map(([n, name, xp]) => def({
    id: `career.heroes_played.${n}`, name, requirement: `Complete games with ${n} different heroes.`, category: 'career', family: 'career.heroes_played',
    mode: 'account', metric: 'heroesPlayed', target: n, xp, trust: 'S',
  })),
  ...([[5, 'Versatile', 100], [15, 'Master of Many', 200]] as const).map(([n, name, xp]) => def({
    id: `career.hero_wins.${n}`, name, requirement: `Finish 1st in Ranked with ${n} different heroes.`, category: 'career', family: 'career.hero_wins',
    mode: 'account', metric: 'heroesWon', target: n, xp, trust: 'S',
  })),
  ...([[10, 'Collector', 50], [25, 'Completionist', 100]] as const).map(([n, name, xp]) => def({
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
 * The 36 playable heroes (not archived), id and display name. The progression package stays dependency-free, so
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
  { id: 'quillen', name: 'Quillen' }, { id: 'hunch', name: 'Hunch' }, { id: 'emeraldwarden', name: 'Emerald Warden' }, { id: 'albus', name: 'Albus' },
  { id: 'flash', name: 'Flash' }, { id: 'midas', name: 'Midas' }, { id: 'juggler', name: 'Juggler' }, { id: 'bram', name: 'Braum' },
  { id: 'cia', name: 'Ayse' }, { id: 'keshi', name: 'Keshi the Protector' }, { id: 'rayse', name: 'Rayse' }, { id: 'mimic', name: 'Mimic' },
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
    def({ ...base, id: `hero.${h.id}.mastery`, family: 'hero.mastery', name: `${h.name}: Mastery`, requirement: `Finish 1st in ${HERO_MASTERY_WINS} Ranked games as ${h.name}.`, mode: 'ranked', placementMax: 1, target: HERO_MASTERY_WINS, xp: 250, titleId: heroMasterTitleId(h.id) }),
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
  def({ id: 'rune.menagerie_win', name: 'Common Cause', requirement: 'Finish 1st in Ranked holding Rune of the Menagerie, with 4 or more tribes on your final board.', category: 'runes', mode: 'ranked', metric: 'menagerieRuneFinalTribes', placementMax: 1, target: 4, xp: 250 }),
];

// Set 2 ──────────────────────────────────────────────────────────────────────────────────────────────────────
const s2 = (group: string, d: Omit<DefInput, 'category' | 'group' | 'setId'>): AchievementDef =>
  def({ ...d, category: 'set2', group, setId: 'set2' });

const SET2: AchievementDef[] = [
  // Kobolds (Rubies)
  s2('kobold', { id: 's2.kobold.rubies_turn_8', name: 'Cut and Set', requirement: 'Play 8 Rubies in one turn.', mode: 'any', metric: 'rubyPlaysTurnMax', target: 8, xp: 100 }),
  s2('kobold', { id: 's2.kobold.rubies_life_500', name: 'Gem Hoarder', requirement: 'Play 500 Rubies across all your Set 2 games.', mode: 'any', metric: 'rubyPlays', agg: 'sum', target: 500, xp: 100 }),
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
  s2('rune', { id: 's2.rune.overtime_5', name: 'Overtime Pay', requirement: 'Have Rune of Overtime pay out 5 times in one game.', mode: 'any', metric: 'overtimeProcs', target: 5, xp: 125 }),
  s2('rune', { id: 's2.rune.blart_10', name: 'Seconds, Please', requirement: 'Have Rune of Blart share its stats 10 times in one game.', mode: 'any', metric: 'blartProcs', target: 10, xp: 125 }),
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
  ...([[10, 'Climber', 300], [25, 'Ever Upward', 600]] as const).map(([n, name, xp]) => ms({
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

/** The 150 added 2026-10-03, in display order. */
export const ACHIEVEMENTS_150: readonly AchievementDef[] = Object.freeze([...SET2_MORE, ...HERO_DEVOTED, ...HEROES_ALL, ...COMBAT, ...MILESTONES]);

/** Every achievement in the game (batch 1 plus the 2026-10-03 150). Order is display order within a category. */
export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([...CAREER, ...RANKED, ...HERO_ACHIEVEMENTS, ...ECONOMY, ...MECHANICS, ...RUNES, ...SET2, ...ACHIEVEMENTS_150]);

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
