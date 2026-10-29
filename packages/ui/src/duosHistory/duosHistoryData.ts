/**
 * DUOS MATCH HISTORY, the client half (owner 2026-10-29: "we're going to want to start capturing duo's match history as
 * well"; R-DUOS-HISTORY-01). Recent Games' DUOS tab reads the signed-in player's finished Duos games (Ranked Duos and
 * Versus Duos) from `duos_match_history`: one row per game, written by the Cloudflare room at the end of the game (see
 * `supabase/migrations/2026-11-13-duos-match-history.sql`), readable only by the players who were in it (RLS).
 *
 * This module is the read and the pure view helpers (who is "you", who is your teammate, the band of a team placement);
 * `DuosGameCard.tsx` renders it with the shared game card.
 */
import { parseDuosHistory, type DuosHistoryMember, type DuosHistoryRecord, type DuosHistoryTeam } from '@game/sim';
import { sessionReady, supabaseClient } from '../remoteBoards';
import type { GameBand } from '../GameCard';

/** How many games the tab lists (the Career's and Recent Games' own row count). */
export const DUOS_ROWS = 50;
const FETCH_TIMEOUT_MS = 4000;

/** The live team's rating change on a rated Ranked Duos game (`duos_rank_results`, stamped when the game was stored). */
export interface DuosRankChange {
  divisionBefore: number;
  pointsBefore: number;
  divisionAfter: number;
  pointsAfter: number;
  delta: number;
  promoted: boolean;
  demoted: boolean;
}

export interface DuosGameRow {
  matchId: string;
  mode: DuosHistoryRecord['mode'];
  startedAt: string | null;
  completedAt: string | null;
  endRound: number;
  /** Null on an unrated game (or Versus Duos). */
  rank: DuosRankChange | null;
  record: DuosHistoryRecord;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseRankChange(v: unknown): DuosRankChange | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const db = num(o.divisionBefore);
  const delta = num(o.delta);
  if (db === null || delta === null) return null;
  return {
    divisionBefore: db, pointsBefore: num(o.pointsBefore) ?? 0, divisionAfter: num(o.divisionAfter) ?? db, pointsAfter: num(o.pointsAfter) ?? 0,
    delta, promoted: o.promoted === true, demoted: o.demoted === true,
  };
}

/** One raw `duos_match_history` row as the tab reads it; null when its record is unreadable. Pure (tested). */
export function asDuosGameRow(r: Record<string, unknown>): DuosGameRow | null {
  const record = parseDuosHistory(r.record);
  if (!record || typeof r.match_id !== 'string') return null;
  return {
    matchId: r.match_id,
    mode: r.mode === 'ranked_duos' ? 'ranked_duos' : 'versus_duos',
    startedAt: typeof r.started_at === 'string' ? r.started_at : record.startedAt ?? null,
    completedAt: typeof r.completed_at === 'string' ? r.completed_at : record.endedAt ?? null,
    endRound: num(r.end_round) ?? record.endRound,
    rank: parseRankChange(r.rank),
    record,
  };
}

/** The signed-in player's finished Duos games, newest first. `[]` with no backend or no user; null when the read failed
 *  or timed out (the tab offers nothing worse than its empty state). */
export async function fetchMyDuosGames(userId: string | null | undefined, limit = DUOS_ROWS): Promise<DuosGameRow[] | null> {
  const c = supabaseClient();
  if (!c || !userId) return [];
  try {
    await sessionReady();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS));
    const q = c.from('duos_match_history').select('match_id, mode, started_at, completed_at, end_round, rank, record')
      .contains('players', [userId]).order('completed_at', { ascending: false }).limit(limit);
    const res = await Promise.race([Promise.resolve(q), timeout]);
    if (!res || res.error || !res.data) return null;
    return (res.data as unknown as Record<string, unknown>[]).map(asDuosGameRow).filter((x): x is DuosGameRow => x !== null);
  } catch {
    return null;
  }
}

// ── the view (pure) ────────────────────────────────────────────────────────────────────────────────────────────────

export interface DuosGameView {
  myTeam: DuosHistoryTeam | null;
  me: DuosHistoryMember | null;
  mate: DuosHistoryMember | null;
  /** My team's placement (null = not placed: an abandoned game). */
  place: number | null;
  teamCount: number;
}

/** Find "you" (by user id) and your teammate. A record without you (never served by the read) falls back to the first
 *  live team, so the card still renders. */
export function duosGameView(rec: DuosHistoryRecord, myId: string | null | undefined): DuosGameView {
  let myTeam: DuosHistoryTeam | null = null;
  let me: DuosHistoryMember | null = null;
  for (const t of rec.teams) {
    const m = myId ? t.members.find((x) => x.userId === myId) : undefined;
    if (m) { myTeam = t; me = m; break; }
  }
  if (!myTeam) { myTeam = rec.teams.find((t) => t.kind === 'live') ?? null; me = myTeam?.members[0] ?? null; }
  const mate = myTeam?.members.find((x) => x !== me) ?? null;
  return { myTeam, me, mate, place: myTeam?.placement ?? null, teamCount: rec.teams.length };
}

/** "1st of 4 teams". */
export function teamPlaceText(place: number | null, teams: number): string {
  if (place === null) return `${teams} teams`;
  const v = place % 100;
  const suf = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[place % 10] ?? 'th';
  return `${place}${suf} of ${teams} teams`;
}

/** A team placement's band: 1st won; the top half of the table (2nd of 4) a good finish; the rest a loss. A Ranked Duos
 *  2nd gains points (+34 / +11 / -11 / -34); a Versus Duos 2nd of 2 is the loss. */
export function duosBand(place: number | null, teams: number): GameBand {
  if (place === null || !(place > 0)) return 'none';
  if (place === 1) return 'won';
  return place <= Math.floor(teams / 2) ? 'top4' : 'lost';
}

export const duosModeLabel = (mode: DuosHistoryRecord['mode']): string => (mode === 'ranked_duos' ? 'Ranked Duos' : 'Versus Duos');

/** "Out R5" / "Winner" / "Still in" for a team. */
export function teamFate(t: DuosHistoryTeam): string {
  if (t.placement === 1) return 'Winner';
  return t.outRound != null ? `Out R${t.outRound}` : 'Still in';
}

/** The game's wall-clock length (hero select to the end), or null. */
export function duosLengthMs(row: Pick<DuosGameRow, 'startedAt' | 'completedAt'>): number | null {
  if (!row.startedAt || !row.completedAt) return null;
  const ms = Date.parse(row.completedAt) - Date.parse(row.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
