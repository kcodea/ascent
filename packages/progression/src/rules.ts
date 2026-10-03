/**
 * ACCOUNT PROGRESSION: the rules (owner decisions 2026-09-27, MVP of the account progression handoff).
 *
 * Account Level is a permanent, earn-only number that grows with every completed game. It never touches the
 * ranked ladder. This file is THE rules: the versioned XP curve, match XP for Ranked / Practice / Tutorial, the
 * comeback streak, the level-milestone titles (Alpha Tester at Level 2) and crates per level, the fact document the client derives at run end,
 * and the presentation payload the server returns.
 *
 * DEPENDENCY-FREE ON PURPOSE (its one import is the sibling catalog, `cosmetics.ts`, generated alongside).
 * `npm run progression:shared` copies this file VERBATIM into
 * `supabase/functions/_shared/progressionRules.ts`, the module the `submit-progression` Edge Function (Deno)
 * imports. `sharedArtifact.test.ts` fails CI when the two drift, so there is exactly ONE hand-edited copy of the
 * TypeScript rules. The SQL writer (`settle_progression`, latest in the 2026-10-03 placement-xp migration) carries the same numbers
 * as plpgsql constants; `sqlParity.test.ts` reads them out of the migration text and compares, and the Edge
 * Function re-derives every settlement from this file at runtime and flags `parity: false` on a mismatch.
 *
 * Change a number here, re-run `npm run progression:shared`, change the SQL constant to match, and bump
 * `PROGRESSION_RULES_VERSION` (here AND `c_rules` in SQL) whenever an old client would mis-show a result.
 * A CURVE change also bumps `PROGRESSION_CURVE_VERSION`: lifetime XP is stored, the level is derived, so a new
 * curve re-derives every account's level without touching its XP.
 */

import { COSMETICS, loadoutFromRows, milestoneLevelOf, type RunCosmeticSnapshot } from './cosmetics';
import { sanitizeRunMetrics, type RunMetric } from './achievements';

// ── Versions ────────────────────────────────────────────────────────────────────────────────────────────────

/** The settlement rules the client pins at run end and the server must serve (a mismatch is a 409). */
export const PROGRESSION_RULES_VERSION = 1;
/** The XP curve. Stored on the profile beside the lifetime XP it was derived with. */
export const PROGRESSION_CURVE_VERSION = 1;
/** The fact document the client builds: `ProgressionRunFactsV2` (V1 + the achievement run metrics, 2026-09-28).
 *  The server still accepts V1 (an older client, or a client that has not seen the achievements switch). */
export const PROGRESSION_FACTS_VERSION = 2;

// ── The curve (handoff §4.2) ───────────────────────────────────────────────────────────────────────────────

/** Piecewise curve, one band per row: every level from `fromLevel` up to and including `toLevel` needs `xp` to
 *  advance to the next. The last band is open-ended. Level 1 → 2 through 10 → 11 is 250 each, 11 → 12 through
 *  25 → 26 is 400 each, 26 → 27 onward is 500 each. Uncapped. */
export const CURVE_BANDS: ReadonlyArray<{ fromLevel: number; toLevel: number | null; xp: number }> = [
  { fromLevel: 1, toLevel: 10, xp: 250 },
  { fromLevel: 11, toLevel: 25, xp: 400 },
  { fromLevel: 26, toLevel: null, xp: 500 },
];

/** XP needed to go from `level` to `level + 1`. */
export function xpToAdvanceFrom(level: number): number {
  for (const band of CURVE_BANDS) {
    if (level >= band.fromLevel && (band.toLevel === null || level <= band.toLevel)) return band.xp;
  }
  return CURVE_BANDS[0]!.xp; // below level 1 never happens; treat as the first band
}

/** Lifetime XP at which `level` begins (Level 1 begins at 0). */
export function xpAtLevelStart(level: number): number {
  let total = 0;
  const target = Math.max(1, Math.floor(level));
  for (const band of CURVE_BANDS) {
    if (target <= band.fromLevel) break;
    const last = band.toLevel === null ? target - 1 : Math.min(band.toLevel, target - 1);
    total += (last - band.fromLevel + 1) * band.xp;
  }
  return total;
}

/** The level a lifetime XP total sits in. Negative or non-finite input reads as 0 XP (Level 1). */
export function levelOfXp(lifetimeXp: number): number {
  let xp = Number.isFinite(lifetimeXp) && lifetimeXp > 0 ? Math.floor(lifetimeXp) : 0;
  let level = 1;
  for (const band of CURVE_BANDS) {
    if (band.toLevel === null) return level + Math.floor(xp / band.xp);
    const span = (band.toLevel - band.fromLevel + 1) * band.xp;
    if (xp < span) return level + Math.floor(xp / band.xp);
    xp -= span;
    level = band.toLevel + 1;
  }
  return level;
}

/** Everything a bar needs, derived from lifetime XP (never store "XP within the level"). */
export interface LevelProgress {
  level: number;
  lifetimeXp: number;
  /** Lifetime XP at which this level began. */
  levelStartXp: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP this level needs in total to advance. */
  xpForNextLevel: number;
  /** XP still needed to reach the next level. */
  xpToNext: number;
  /** 0..1, for the bar. */
  fraction: number;
}

export function levelProgress(lifetimeXp: number): LevelProgress {
  const xp = Number.isFinite(lifetimeXp) && lifetimeXp > 0 ? Math.floor(lifetimeXp) : 0;
  const level = levelOfXp(xp);
  const levelStartXp = xpAtLevelStart(level);
  const xpForNextLevel = xpToAdvanceFrom(level);
  const xpIntoLevel = xp - levelStartXp;
  return {
    level, lifetimeXp: xp, levelStartXp, xpIntoLevel, xpForNextLevel,
    xpToNext: xpForNextLevel - xpIntoLevel,
    fraction: Math.min(1, Math.max(0, xpIntoLevel / xpForNextLevel)),
  };
}

// ── Match XP (handoff §4.3) ────────────────────────────────────────────────────────────────────────────────

export type ProgressionMode = 'ranked' | 'practice' | 'tutorial';
export const PROGRESSION_MODES: readonly ProgressionMode[] = ['ranked', 'practice', 'tutorial'];

export const XP_RULES = {
  /** Complete an accepted Ranked run. */
  complete: 100,
  /** Finish Top 4 (1st to 4th). 40 until owner 2026-10-03 ("+50% bonuses"). */
  topFour: 60,
  /** Finish 1st (on top of Top 4). 60 until owner 2026-10-03 ("+50% bonuses"). */
  firstPlace: 90,
  /** Win a combat right after 4+ consecutive combat losses, once per run. */
  comeback: 25,
  /** The loss streak the comeback needs. */
  comebackStreak: 4,
  /** Practice earns this share of the equivalent Ranked XP, summed then rounded. As a percent so the SQL copy
   *  (integer math) and this copy cannot disagree on a float. */
  practicePercent: 60,
  /** A custom Practice with no meaningful placement (Unlimited Health curtain): flat XP for a valid finish. */
  practiceFlat: 60,
  /** First completion of the current Learn Ascent course version. */
  tutorial: 250,
} as const;

export const TUTORIAL_COURSE_ID = 'learn-ascent';
export const TUTORIAL_COURSE_VERSION = 1;
/** The dedupe key of the one tutorial settlement an account can ever make for this course version. */
export const tutorialRunId = (courseId: string = TUTORIAL_COURSE_ID, version: number = TUTORIAL_COURSE_VERSION): string => `${courseId}:v${version}`;
/** A practice settlement's run id is its `practice_games` row id: one row, one settlement. */
export const practiceRunId = (practiceGameId: number): string => `practice:${practiceGameId}`;

export interface XpBreakdown {
  base: number;
  topFour: number;
  firstPlace: number;
  comeback: number;
  total: number;
}

export const ZERO_XP: XpBreakdown = Object.freeze({ base: 0, topFour: 0, firstPlace: 0, comeback: 0, total: 0 });

export const isValidPlacement = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 8;

/**
 * The XP one settlement awards, from the facts the SERVER trusts: the mode, the placement (null when the game
 * has no meaningful placement) and whether the comeback bonus applies. A non-terminal game earns nothing.
 *
 *  - Ranked: 100 + 60 (Top 4) + 90 (1st) + 25 (comeback). A ranked game with no valid placement earns nothing
 *    (it was never accepted by the ladder).
 *  - Practice: each component at 60%, the rounding remainder folded into `base` so `total` is exactly
 *    `round(0.60 * equivalent ranked XP)`. No meaningful placement: a flat 60, no bonuses.
 *  - Tutorial: 250 flat.
 */
export function xpForSettlement(input: { mode: ProgressionMode; placement: number | null; comeback: boolean; terminal?: boolean }): XpBreakdown {
  if (input.terminal === false) return { ...ZERO_XP };
  if (input.mode === 'tutorial') return { base: XP_RULES.tutorial, topFour: 0, firstPlace: 0, comeback: 0, total: XP_RULES.tutorial };
  const placed = isValidPlacement(input.placement);
  if (input.mode === 'practice' && !placed) {
    return { base: XP_RULES.practiceFlat, topFour: 0, firstPlace: 0, comeback: 0, total: XP_RULES.practiceFlat };
  }
  if (!placed) return { ...ZERO_XP };
  const p = input.placement as number;
  const ranked = {
    base: XP_RULES.complete,
    topFour: p <= 4 ? XP_RULES.topFour : 0,
    firstPlace: p === 1 ? XP_RULES.firstPlace : 0,
    comeback: input.comeback ? XP_RULES.comeback : 0,
  };
  const rankedTotal = ranked.base + ranked.topFour + ranked.firstPlace + ranked.comeback;
  if (input.mode === 'ranked') return { ...ranked, total: rankedTotal };
  // Practice: scale each piece, then make the pieces sum to round(total * 0.60) exactly.
  const total = scalePercent(rankedTotal);
  const topFour = scalePercent(ranked.topFour);
  const firstPlace = scalePercent(ranked.firstPlace);
  const comeback = scalePercent(ranked.comeback);
  return { base: total - topFour - firstPlace - comeback, topFour, firstPlace, comeback, total };
}

/** round(xp * 60 / 100), half away from zero, in integers (the SQL copy does the same integer math). */
function scalePercent(xp: number): number {
  return Math.floor((xp * XP_RULES.practicePercent + 50) / 100);
}

export const sameXpBreakdown = (a: XpBreakdown, b: XpBreakdown): boolean =>
  a.base === b.base && a.topFour === b.topFour && a.firstPlace === b.firstPlace && a.comeback === b.comeback && a.total === b.total;

// ── The comeback streak (handoff §4.3 "Comeback definition") ──────────────────────────────────────────────

export type CombatOutcome = 'win' | 'loss' | 'draw';

/**
 * Did this run earn the comeback bonus? A loss grows the streak, a draw neither grows nor clears it, and a win
 * after a streak of 4+ earns the bonus (once per run: the answer is a boolean). Any other win clears the streak.
 */
export function comebackAfterLosses(results: readonly CombatOutcome[], streakNeeded: number = XP_RULES.comebackStreak): boolean {
  let streak = 0;
  for (const r of results) {
    if (r === 'loss') streak++;
    else if (r === 'win') {
      if (streak >= streakNeeded) return true;
      streak = 0;
    }
  }
  return false;
}

// ── The fact document (handoff §7.1, MVP subset) ──────────────────────────────────────────────────────────

/**
 * What happened in one finished run, derived by the run observer (`progressionFactsOf` in
 * packages/sim/src/runDerive.ts). Facts, not rewards: the XP is computed from them, and a future achievement
 * layer reads the same document. MINIMAL for the MVP; new fields arrive as a new version.
 */
export interface ProgressionRunFactsV1 {
  version: 1;
  runId: string;
  mode: ProgressionMode;
  setId: string;
  patch: string;
  heroId: string;
  /** Final placement 1..8, or null when the game has no meaningful placement (Practice on Unlimited Health). */
  placement: number | null;
  waveReached: number;
  /** The run reached its end (not quit, not a sandbox). */
  terminal: boolean;
  comebackAfterFourLosses: boolean;
  combats: { wins: number; losses: number; draws: number };
}

/** The XP these facts earn, exactly as the server will compute it from its own source rows. */
export function matchXp(facts: Pick<ProgressionRunFactsV1, 'mode' | 'placement' | 'terminal' | 'comebackAfterFourLosses'>): XpBreakdown {
  return xpForSettlement({ mode: facts.mode, placement: facts.placement, comeback: facts.comebackAfterFourLosses, terminal: facts.terminal });
}

/**
 * V2 (achievements batch 1, 2026-09-28): V1 plus `metrics`, the run metrics the observer counted (see
 * `RUN_METRICS` in achievements.ts). Additive: every V1 key keeps its meaning, and the server accepts both.
 */
export interface ProgressionRunFactsV2 extends Omit<ProgressionRunFactsV1, 'version'> {
  version: 2;
  metrics: Partial<Record<RunMetric, number>>;
}
export type ProgressionRunFacts = ProgressionRunFactsV1 | ProgressionRunFactsV2;

/** Structural check the server runs on the facts a client sends (V1 or V2; V2's metrics are sanitized separately). */
export function isProgressionFacts(v: unknown): v is ProgressionRunFacts {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const c = o.combats as Record<string, unknown> | undefined;
  const nonNegInt = (x: unknown): boolean => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1000;
  return (o.version === 1 || (o.version === 2 && !!o.metrics && typeof o.metrics === 'object' && !Array.isArray(o.metrics)))
    && typeof o.runId === 'string' && o.runId.length > 0 && o.runId.length <= 128
    && typeof o.mode === 'string' && (PROGRESSION_MODES as readonly string[]).includes(o.mode)
    && typeof o.setId === 'string' && o.setId.length <= 32
    && typeof o.patch === 'string' && o.patch.length <= 96
    && typeof o.heroId === 'string' && o.heroId.length <= 64
    && (o.placement === null || isValidPlacement(o.placement))
    && nonNegInt(o.waveReached)
    && typeof o.terminal === 'boolean'
    && typeof o.comebackAfterFourLosses === 'boolean'
    && !!c && nonNegInt(c.wins) && nonNegInt(c.losses) && nonNegInt(c.draws);
}

/**
 * The facts exactly as the server stores and evaluates them: the V1 keys copied, and (V2) only the known run
 * metrics with sane values. Null for anything that is not a fact document. Unknown or out-of-range metrics are
 * DROPPED, never an error: a bad counter must never cost a player the game's XP.
 */
export function sanitizeProgressionFacts(v: unknown): ProgressionRunFacts | null {
  if (!isProgressionFacts(v)) return null;
  const base = {
    runId: v.runId, mode: v.mode, setId: v.setId, patch: v.patch, heroId: v.heroId, placement: v.placement,
    waveReached: v.waveReached, terminal: v.terminal, comebackAfterFourLosses: v.comebackAfterFourLosses,
    combats: { wins: v.combats.wins, losses: v.combats.losses, draws: v.combats.draws },
  };
  return v.version === 2 ? { version: 2, ...base, metrics: sanitizeRunMetrics(v.metrics) } : { version: 1, ...base };
}

/** The V1 document for a server that predates achievements (or while the achievements switch is off). */
export function factsAsV1(f: ProgressionRunFacts): ProgressionRunFactsV1 {
  if (f.version === 1) return f;
  return {
    version: 1, runId: f.runId, mode: f.mode, setId: f.setId, patch: f.patch, heroId: f.heroId, placement: f.placement,
    waveReached: f.waveReached, terminal: f.terminal, comebackAfterFourLosses: f.comebackAfterFourLosses, combats: f.combats,
  };
}

// ── Titles (level milestones; the catalog lives in cosmetics.ts) ──────────────────────────────────────────

export interface TitleDef {
  id: string;
  /** Player-facing. */
  name: string;
  /** Unlocked by reaching this Account Level (null: from a crate or some other source). */
  unlockLevel: number | null;
}

/** Every title in the catalog (level milestones AND crate titles), keyed by id. */
export const TITLES: Readonly<Record<string, TitleDef>> = Object.freeze(Object.fromEntries(
  COSMETICS.filter((c) => c.category === 'title').map((c) => [c.id, { id: c.id, name: c.name, unlockLevel: milestoneLevelOf(c) }]),
));

/** The display name of a title id, or null for an unknown id (a newer server's title on an older client). */
export const titleName = (id: string | null | undefined): string | null => (id && TITLES[id] ? TITLES[id]!.name : null);

/** Every level-unlocked title an account at `level` owns. */
export function titlesForLevel(level: number): string[] {
  return Object.values(TITLES).filter((t) => t.unlockLevel !== null && level >= t.unlockLevel).map((t) => t.id);
}

/** Titles newly crossed when a settlement moves the level from `before` to `after`. */
export function titlesUnlockedBetween(levelBefore: number, levelAfter: number): string[] {
  return Object.values(TITLES)
    .filter((t) => t.unlockLevel !== null && levelBefore < t.unlockLevel && levelAfter >= t.unlockLevel)
    .map((t) => t.id);
}

// ── Crates per level (handoff §5.1) ──────────────────────────────────────────────────────────────────────

/**
 * The crates an account holds for reaching `level`: one per level, Level 1's being the Welcome Crate granted on
 * enrollment. So an account at Level L has earned exactly L crates, and a settlement from `before` to `after`
 * creates `after - before` (plus the Welcome Crate when it is the account's first settlement).
 */
export const cratesEarnedThrough = (level: number): number => Math.max(0, Math.floor(level));
export const cratesForSettlement = (levelBefore: number, levelAfter: number, enrolling: boolean): number =>
  Math.max(0, levelAfter - levelBefore) + (enrolling ? 1 : 0);

// ── The presentation payload (what `settle_progression` returns, key for key) ─────────────────────────────

export interface ProgressionResult {
  runId: string;
  mode: ProgressionMode;
  rulesVersion: number;
  /** The placement the server scored (null: no meaningful placement, or tutorial). */
  placement: number | null;
  /** Whether the server accepted the comeback bonus. */
  comeback: boolean;
  xp: XpBreakdown;
  before: { lifetimeXp: number; level: number };
  after: { lifetimeXp: number; level: number };
  /** Titles this settlement unlocked for the first time (the reveal list). */
  unlockedTitles: string[];
  /** Sealed crates this settlement created (one per new level, plus the Welcome Crate on enrollment). */
  cratesAwarded: number;
  /** Their ids, oldest level first (the post-game Open button opens these). */
  crateIds: string[];
  /** Achievements this settlement completed (2026-09-28), in completion order, and the XP they paid on top of
   *  `xp.total` (so `after.lifetimeXp = before.lifetimeXp + xp.total + achievementXp`). Absent from a
   *  pre-achievements server: read as none. */
  achievements: string[];
  achievementXp: number;
  revisionAfter: number;
  settledAt: string | null;
}

export interface ProgressionProfile {
  accountXp: number;
  accountLevel: number;
  revision: number;
  equippedTitleId: string | null;
  titles: string[];
  /** Every cosmetic the account owns, any category (skins included). Absent from a pre-skins server: read as the
   *  titles alone. Retired items are still listed (ownership is never deleted); the client hides them. */
  cosmetics?: string[];
  /** The equipped skins, by target (only LIVE items: the SQL drops a retired one). Absent from a pre-skins server. */
  loadout?: RunCosmeticSnapshot;
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : null);

function parseXp(v: unknown): XpBreakdown | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const base = int(o.base); const topFour = int(o.topFour); const firstPlace = int(o.firstPlace); const comeback = int(o.comeback); const total = int(o.total);
  if (base === null || topFour === null || firstPlace === null || comeback === null || total === null) return null;
  return { base, topFour, firstPlace, comeback, total };
}

function parsePoint(v: unknown): { lifetimeXp: number; level: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const lifetimeXp = int(o.lifetimeXp); const level = int(o.level);
  if (lifetimeXp === null || level === null || lifetimeXp < 0 || level < 1) return null;
  return { lifetimeXp, level };
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Parse the server's result object; null for anything that is not one (never a fabricated result). */
export function parseProgressionResult(v: unknown): ProgressionResult | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const xp = parseXp(o.xp); const before = parsePoint(o.before); const after = parsePoint(o.after);
  const rulesVersion = int(o.rulesVersion); const revisionAfter = int(o.revisionAfter);
  if (typeof o.runId !== 'string' || !(PROGRESSION_MODES as readonly string[]).includes(o.mode as string)) return null;
  if (!xp || !before || !after || rulesVersion === null || revisionAfter === null) return null;
  const placement = int(o.placement);
  return {
    runId: o.runId, mode: o.mode as ProgressionMode, rulesVersion,
    placement: placement !== null && isValidPlacement(placement) ? placement : null,
    comeback: o.comeback === true, xp, before, after,
    unlockedTitles: stringList(o.unlockedTitles),
    // A pre-crates server (the 2026-09-27 SQL) sends neither: read as none.
    cratesAwarded: Math.max(0, int(o.cratesAwarded) ?? 0), crateIds: stringList(o.crateIds),
    // A pre-achievements server sends neither: read as none.
    achievements: stringList(o.achievements), achievementXp: Math.max(0, int(o.achievementXp) ?? 0),
    revisionAfter,
    settledAt: typeof o.settledAt === 'string' ? o.settledAt : null,
  };
}

/** Parse the server's profile object; null for anything that is not one. */
export function parseProgressionProfile(v: unknown): ProgressionProfile | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const accountXp = int(o.accountXp); const accountLevel = int(o.accountLevel); const revision = int(o.revision);
  if (accountXp === null || accountLevel === null || revision === null || accountXp < 0 || accountLevel < 1) return null;
  return {
    accountXp, accountLevel, revision,
    equippedTitleId: typeof o.equippedTitleId === 'string' ? o.equippedTitleId : null,
    titles: stringList(o.titles),
    ...(Array.isArray(o.cosmetics) ? { cosmetics: stringList(o.cosmetics) } : {}),
    ...(Array.isArray(o.loadout) ? { loadout: loadoutFromRows(o.loadout) } : {}),
  };
}
