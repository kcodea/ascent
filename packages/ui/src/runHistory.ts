import { CARD_INDEX } from '@game/content';
import type { Tribe } from '@game/core';
import { buildTags, lineResult, metLine, runMvp, runRecord, topMechanic, type BoardSnapshot, type LineStatus, type RatingChange, type RunState } from '@game/sim';

/**
 * Career / match history (A7) — the persistence layer. On run-end, a compact per-run entry is appended to
 * localStorage so runs stop disappearing; the Career screen reads them back. Ascent runs only (Practice is a
 * sandbox with no record/line). All best-effort — localStorage may be unavailable; failures never break play.
 *
 * This file is pure data + storage; the Career UI (a later PR) renders `loadRunHistory()` + `careerStats()`.
 */
export interface RunHistoryEntry {
  v: 1;
  date: string; // ISO yyyy-mm-dd, stamped at run end
  seed: number;
  heroId: string;
  wins: number;
  losses: number;
  draws: number;
  line: number;
  lineStatus: LineStatus;
  completed: boolean; // finished the course (victory) vs died (gameover)
  wave: number; // round reached
  tags: string[];
  tribes: Tribe[];
  boardsContributed: number;
  board: BoardSnapshot | null; // final warband, for the list preview
  // Run stats (added later; may be absent on older saved entries — default when reading).
  triples?: number;
  goldSpent?: number;
  apt?: number; // actions per round
  cardsPlayed?: number;
  dominantTribe?: Tribe | null; // the final board's top non-neutral tribe
  strongest?: { name: string; attack: number; health: number } | null; // biggest final-board minion
  mvp?: { name: string; damage: number } | null; // most attack damage dealt across the run
  topMechanic?: { name: string; count: number } | null; // most-triggered combat mechanic
  // Rating (career skill pressure; absent on entries from before the rating system). `lineDelta` = scored
  // wins − line (the run's over/under-par). See `@game/sim` playerRating.
  ratingBefore?: number;
  ratingAfter?: number;
  ratingDelta?: number;
  lineDelta?: number;
  /** Lobby finish position (1 = won the lobby). Already written by `uploadRunHistory`, which spreads it onto
   *  the entry; declared here so the Career can read it. It is the WIN/LOSS answer now that the Oath verdict
   *  is no longer shown (owner 2026-08-04) — absent on pre-lobby entries, which fall back to the Line. */
  placement?: number;
  mode?: string;
}

/** 1st / 2nd / 3rd / 4th … — English ordinals, including the 11th/12th/13th exceptions that a naive
 *  last-digit rule gets wrong. A lobby only ever seats 8, but the rule is cheap and correct for any N. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** How a finished run reads on the Career: won it, made the top half, or fell out. */
export type RunVerdict = 'victory' | 'top4' | 'defeat';

/** Placements 2–4 read as a good result, not a loss. */
const TOP_CUT = 4;

/**
 * The run's verdict (owner 2026-08-04: *"the results should be Victory, Defeat, Top 4"*).
 *
 * An eight-seat lobby is not win-or-lose: finishing 2nd–4th is a good run and the Rating agrees — those
 * placements score POSITIVE (the screenshot that prompted this had 2nd at +71 and 4th at +13, both labelled
 * DEFEAT). Calling them defeats contradicted the number printed beside them.
 *
 * Entries with NO placement predate lobbies and have no finish position to grade, so they fall back to the
 * old Line verdict and stay binary — there is no honest way to infer a top-4 from a course run.
 */
export function runVerdict(e: Pick<RunHistoryEntry, 'placement' | 'lineStatus'>): RunVerdict {
  if (e.placement === undefined) return metLine(e.lineStatus) ? 'victory' : 'defeat';
  if (e.placement === 1) return 'victory';
  return e.placement <= TOP_CUT ? 'top4' : 'defeat';
}

/** Label + colour class for a verdict. `top4` is GREEN like a victory (owner ask) — the placement chip beside
 *  it is what distinguishes 1st from 3rd, so the colour only has to say "this went well". */
export const VERDICT_LABEL: Record<RunVerdict, string> = { victory: 'Victory', top4: 'Top 4', defeat: 'Defeat' };
export const VERDICT_CLASS: Record<RunVerdict, string> = { victory: 'won', top4: 'top4', defeat: 'lost' };

/** The final board's top non-neutral tribe (both tribes counted), or null for an empty/all-neutral board. */
function dominantTribeOf(run: RunState): Tribe | null {
  const count = new Map<Tribe, number>();
  for (const m of run.board) {
    const def = CARD_INDEX[m.cardId];
    for (const t of [def?.tribe, def?.tribe2].filter((t): t is Tribe => !!t && t !== 'neutral')) count.set(t, (count.get(t) ?? 0) + 1);
  }
  let top: Tribe | null = null;
  let best = 0;
  for (const [t, c] of count) if (c > best) { best = c; top = t; }
  return top;
}

/** Build a history entry from a finished run + the run-end extras (capture count, final board, date, APT). */
export function buildRunHistoryEntry(
  run: RunState,
  extra: { date: string; boardsContributed: number; board: BoardSnapshot | null; apt: number; cardsPlayed: number; rating?: RatingChange },
): RunHistoryEntry {
  const rec = runRecord(run);
  const lr = lineResult(run);
  const big = run.board.reduce<RunState['board'][number] | null>((b, m) => (!b || m.attack + m.health > b.attack + b.health ? m : b), null);
  return {
    v: 1,
    date: extra.date,
    seed: run.seed,
    heroId: run.heroId,
    wins: rec.wins,
    losses: rec.losses,
    draws: rec.draws,
    line: lr.line,
    lineStatus: lr.status,
    completed: run.phase === 'victory',
    wave: run.wave,
    tags: buildTags(run),
    tribes: run.tribes,
    boardsContributed: extra.boardsContributed,
    board: extra.board,
    triples: run.triplesMade,
    goldSpent: run.goldSpent,
    apt: extra.apt,
    cardsPlayed: extra.cardsPlayed,
    dominantTribe: dominantTribeOf(run),
    strongest: big ? { name: CARD_INDEX[big.cardId]?.name ?? big.cardId, attack: big.attack, health: big.health } : null,
    mvp: runMvp(run.runDamage),
    topMechanic: topMechanic(run.runProcs),
    ratingBefore: extra.rating?.ratingBefore,
    ratingAfter: extra.rating?.ratingAfter,
    ratingDelta: extra.rating?.ratingDelta,
    lineDelta: extra.rating?.lineDelta,
  };
}

const KEY = 'ascent.history';
const CAP = 50; // keep the most recent N runs

/** Load the match history, newest first. Best-effort: [] on any missing/parse/shape problem. */
export function loadRunHistory(): RunHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr.filter((e) => e && (e as RunHistoryEntry).v === 1) as RunHistoryEntry[]) : [];
  } catch { return []; }
}

/** Prepend an entry (newest first), cap the log, persist. Returns the new list. */
export function saveRunHistoryEntry(entry: RunHistoryEntry): RunHistoryEntry[] {
  try {
    const next = [entry, ...loadRunHistory()].slice(0, CAP);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch { return []; }
}

/** Wipe the local match history (the Career then reads []). Best-effort — never throws. */
export function clearRunHistory(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export interface HeroStat {
  heroId: string;
  runs: number;
  wins: number; // total scored wins across this hero's runs
  bestWins: number;
  avgWins: number;
  completions: number; // courses finished
  lineWins: number; // runs with this hero that covered par (metLine)
  lineLosses: number; // runs with this hero that fell short (runs - lineWins)
}

export interface CareerStats {
  runs: number;
  bestWins: number;
  avgWins: number;
  completions: number;
  flawless: number; // runs with a flawless line result (won every scored round)
  triples: number; // total triples across all runs
  avgGold: number; // avg Gold spent per run
  avgApt: number; // avg actions per round
  winRate: number; // runs that met their line (covered+) / total runs, as a 0–100 integer percent
  streak: number; // current run streak (from newest) of runs that met their line (covered+)
  bestRun: { wins: number; losses: number } | null; // record of the highest-win run
  topTribes: { tribe: Tribe; count: number }[]; // most-played final-board tribes
  favoriteMechanic: string | null; // the mechanic most often a run's most-triggered
  favoriteMinion: string | null; // the minion most often on the final board across runs (display name)
  perHero: HeroStat[]; // sorted by runs desc
  // ── LOBBY stats (owner 2026-08-08: the course-shaped numbers above read as nonsense for lobby play) ──
  // A lobby has no 17-round course and no Oath, so `completions` / `flawless` / the line-based `winRate` are
  // structurally 0 or meaningless there. These are the battle-royale equivalents, computed only over entries
  // that actually recorded a `placement`; the Career shows them whenever `lobbyRuns > 0`.
  lobbyRuns: number;         // entries with a recorded placement
  firsts: number;            // placement === 1
  topFours: number;          // placement <= 4 — the genre's real "win"
  top4Rate: number;          // topFours / lobbyRuns, 0–100 integer percent
  avgPlacement: number | null;  // the single most meaningful lobby number
  bestPlacement: number | null; // best (lowest) finish
  lobbyStreak: number;       // consecutive newest lobby runs that finished top 4
}

/** Aggregate the match history into overall + per-hero career stats. Pure. */
export function careerStats(entries: RunHistoryEntry[]): CareerStats {
  const runs = entries.length;
  const empty: CareerStats = { runs: 0, bestWins: 0, avgWins: 0, completions: 0, flawless: 0, triples: 0, avgGold: 0, avgApt: 0, winRate: 0, streak: 0, bestRun: null, topTribes: [], favoriteMechanic: null, favoriteMinion: null, perHero: [], lobbyRuns: 0, firsts: 0, topFours: 0, top4Rate: 0, avgPlacement: null, bestPlacement: null, lobbyStreak: 0 };
  if (runs === 0) return empty;
  let bestWins = 0, totalWins = 0, completions = 0, flawless = 0, triples = 0, totalGold = 0, goldRuns = 0, totalApt = 0, aptRuns = 0, lineWins = 0;
  let bestRun: { wins: number; losses: number } | null = null;
  const heroes = new Map<string, HeroStat>();
  const tribes = new Map<Tribe, number>();
  const mechanics = new Map<string, number>();
  const minions = new Map<string, number>(); // cardId → times on a final board (favorite minion)
  let lobbyRuns = 0, firsts = 0, topFours = 0, placementSum = 0, bestPlacement: number | null = null;
  for (const e of entries) {
    if (typeof e.placement === 'number' && e.placement > 0) {
      lobbyRuns++;
      placementSum += e.placement;
      if (e.placement === 1) firsts++;
      if (e.placement <= 4) topFours++;
      if (bestPlacement === null || e.placement < bestPlacement) bestPlacement = e.placement;
    }
    if (e.wins > bestWins || bestRun === null) { bestWins = Math.max(bestWins, e.wins); bestRun = { wins: e.wins, losses: e.losses }; }
    totalWins += e.wins;
    if (e.completed) completions++;
    const covered = metLine(e.lineStatus);
    if (covered) lineWins++;
    if (e.lineStatus === 'flawless') flawless++;
    triples += e.triples ?? 0;
    if (e.goldSpent !== undefined) { totalGold += e.goldSpent; goldRuns++; }
    if (e.apt !== undefined) { totalApt += e.apt; aptRuns++; }
    if (e.dominantTribe) tribes.set(e.dominantTribe, (tribes.get(e.dominantTribe) ?? 0) + 1);
    if (e.topMechanic) mechanics.set(e.topMechanic.name, (mechanics.get(e.topMechanic.name) ?? 0) + 1);
    for (const m of e.board?.minions ?? []) minions.set(m.cardId, (minions.get(m.cardId) ?? 0) + 1);
    const h = heroes.get(e.heroId) ?? { heroId: e.heroId, runs: 0, wins: 0, bestWins: 0, avgWins: 0, completions: 0, lineWins: 0, lineLosses: 0 };
    h.runs++;
    h.wins += e.wins;
    h.bestWins = Math.max(h.bestWins, e.wins);
    if (e.completed) h.completions++;
    if (covered) h.lineWins++; else h.lineLosses++;
    heroes.set(e.heroId, h);
  }
  const perHero = [...heroes.values()]
    .map((h) => ({ ...h, avgWins: Math.round((h.wins / h.runs) * 10) / 10 }))
    .sort((a, b) => b.runs - a.runs);
  const topTribes = [...tribes.entries()].map(([tribe, count]) => ({ tribe, count })).sort((a, b) => b.count - a.count).slice(0, 3);
  const favoriteMechanic = [...mechanics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const favMinionId = [...minions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const favoriteMinion = favMinionId ? (CARD_INDEX[favMinionId]?.name ?? favMinionId) : null;
  // Current streak: consecutive newest runs (entries are newest-first) that met their line.
  let streak = 0;
  for (const e of entries) { if (metLine(e.lineStatus)) streak++; else break; }
  // The lobby streak walks the newest LOBBY entries only (a course run in between neither breaks nor extends
  // it — it simply isn't a lobby result) and counts top-4 finishes, the genre's unit of success.
  let lobbyStreak = 0;
  for (const e of entries) {
    if (typeof e.placement !== 'number' || e.placement <= 0) continue;
    if (e.placement <= 4) lobbyStreak++; else break;
  }
  return {
    runs, bestWins, avgWins: Math.round((totalWins / runs) * 10) / 10, completions, flawless, triples,
    avgGold: goldRuns ? Math.round(totalGold / goldRuns) : 0,
    avgApt: aptRuns ? Math.round((totalApt / aptRuns) * 10) / 10 : 0,
    winRate: runs ? Math.round((lineWins / runs) * 100) : 0,
    streak, bestRun,
    topTribes, favoriteMechanic, favoriteMinion, perHero,
    lobbyRuns, firsts, topFours,
    top4Rate: lobbyRuns ? Math.round((topFours / lobbyRuns) * 100) : 0,
    avgPlacement: lobbyRuns ? Math.round((placementSum / lobbyRuns) * 10) / 10 : null,
    bestPlacement, lobbyStreak,
  };
}
