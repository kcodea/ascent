import type { Tribe } from '@game/core';
import { buildTags, lineResult, runRecord, type BoardSnapshot, type LineStatus, type RunState } from '@game/sim';

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
}

/** Build a history entry from a finished run + the run-end extras (capture count, final board, date). */
export function buildRunHistoryEntry(
  run: RunState,
  extra: { date: string; boardsContributed: number; board: BoardSnapshot | null },
): RunHistoryEntry {
  const rec = runRecord(run);
  const lr = lineResult(run);
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
  perHero: HeroStat[]; // sorted by runs desc
}

/** Aggregate the match history into overall + per-hero career stats. Pure. */
export function careerStats(entries: RunHistoryEntry[]): CareerStats {
  const runs = entries.length;
  if (runs === 0) return { runs: 0, bestWins: 0, avgWins: 0, completions: 0, perHero: [] };
  let bestWins = 0;
  let totalWins = 0;
  let completions = 0;
  const heroes = new Map<string, HeroStat>();
  for (const e of entries) {
    bestWins = Math.max(bestWins, e.wins);
    totalWins += e.wins;
    if (e.completed) completions++;
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
  return { runs, bestWins, avgWins: Math.round((totalWins / runs) * 10) / 10, completions, perHero };
}
