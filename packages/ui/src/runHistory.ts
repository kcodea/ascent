import { CARD_INDEX } from '@game/content';
import type { Tribe } from '@game/core';
import { buildTags, lineResult, runMvp, runRecord, topMechanic, type BoardSnapshot, type LineStatus, type RunState } from '@game/sim';

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
}

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
  extra: { date: string; boardsContributed: number; board: BoardSnapshot | null; apt: number; cardsPlayed: number },
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

export interface HeroStat {
  heroId: string;
  runs: number;
  wins: number; // total scored wins across this hero's runs
  bestWins: number;
  avgWins: number;
  completions: number; // courses finished
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
  topTribes: { tribe: Tribe; count: number }[]; // most-played final-board tribes
  favoriteMechanic: string | null; // the mechanic most often a run's most-triggered
  perHero: HeroStat[]; // sorted by runs desc
}

/** Aggregate the match history into overall + per-hero career stats. Pure. */
export function careerStats(entries: RunHistoryEntry[]): CareerStats {
  const runs = entries.length;
  const empty: CareerStats = { runs: 0, bestWins: 0, avgWins: 0, completions: 0, flawless: 0, triples: 0, avgGold: 0, avgApt: 0, topTribes: [], favoriteMechanic: null, perHero: [] };
  if (runs === 0) return empty;
  let bestWins = 0, totalWins = 0, completions = 0, flawless = 0, triples = 0, totalGold = 0, goldRuns = 0, totalApt = 0, aptRuns = 0;
  const heroes = new Map<string, HeroStat>();
  const tribes = new Map<Tribe, number>();
  const mechanics = new Map<string, number>();
  for (const e of entries) {
    bestWins = Math.max(bestWins, e.wins);
    totalWins += e.wins;
    if (e.completed) completions++;
    if (e.lineStatus === 'flawless') flawless++;
    triples += e.triples ?? 0;
    if (e.goldSpent !== undefined) { totalGold += e.goldSpent; goldRuns++; }
    if (e.apt !== undefined) { totalApt += e.apt; aptRuns++; }
    if (e.dominantTribe) tribes.set(e.dominantTribe, (tribes.get(e.dominantTribe) ?? 0) + 1);
    if (e.topMechanic) mechanics.set(e.topMechanic.name, (mechanics.get(e.topMechanic.name) ?? 0) + 1);
    const h = heroes.get(e.heroId) ?? { heroId: e.heroId, runs: 0, wins: 0, bestWins: 0, avgWins: 0, completions: 0 };
    h.runs++;
    h.wins += e.wins;
    h.bestWins = Math.max(h.bestWins, e.wins);
    if (e.completed) h.completions++;
    heroes.set(e.heroId, h);
  }
  const perHero = [...heroes.values()]
    .map((h) => ({ ...h, avgWins: Math.round((h.wins / h.runs) * 10) / 10 }))
    .sort((a, b) => b.runs - a.runs);
  const topTribes = [...tribes.entries()].map(([tribe, count]) => ({ tribe, count })).sort((a, b) => b.count - a.count).slice(0, 3);
  const favoriteMechanic = [...mechanics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    runs, bestWins, avgWins: Math.round((totalWins / runs) * 10) / 10, completions, flawless, triples,
    avgGold: goldRuns ? Math.round(totalGold / goldRuns) : 0,
    avgApt: aptRuns ? Math.round((totalApt / aptRuns) * 10) / 10 : 0,
    topTribes, favoriteMechanic, perHero,
  };
}
