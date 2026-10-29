/**
 * DUOS MATCH HISTORY (owner 2026-10-29: "we're going to want to start capturing duo's match history as well").
 *
 * A compact, serializable record of ONE finished Duos game (Ranked Duos or Versus Duos), written ONCE at the source when
 * the game ends: the Cloudflare room builds it from what it holds in memory (the live seats' last fought boards, the
 * recorded teams' recordings) and sends it with its end-of-game job; the writer (`versus_cf_persist`) stores it in
 * `duos_match_history`, keyed by the match, readable by every player who was in the game. So all four players read the
 * SAME authoritative record, never a client upload.
 *
 * Every team, in table order, with its placement and the round it went out, and each member's name, hero and the board it
 * last fought with (a recorded member: its recording's board for the round its team went out, or the end round). Boards
 * are the card-render fields only (no text, no buffs, no replay), so a whole table weighs a few KB.
 *
 * Pure and dependency-free (type imports only), so the Worker bundle can import it (`@game/sim/versus/duosHistory`).
 * The backfill (`supabase/migrations/2026-11-13-duos-match-history.sql`) builds the same shape in SQL from the tables.
 */
import type { BoardMinion, Keyword, Tribe } from '@game/core';
import type { MatchBoard } from '../lobby/matchDetails';

export const DUOS_HISTORY_VERSION = 1;
/** Hard cap on the serialized record (JSON bytes). Eight full boards measure ~4-6 KB; the SQL column allows 32 KB. */
export const DUOS_HISTORY_MAX_BYTES = 24_000;

export type DuosHistoryMode = 'ranked_duos' | 'versus_duos';
/** A team's kind: the live players, or a recorded team (a duo run, two solo runs paired, a generated table seat). */
export type DuosHistoryTeamKind = 'live' | 'duo' | 'pair' | 'generated';

export interface DuosHistoryMember {
  /** The live seat ('p1'..'p4'), or a recorded member ('b0', 'b1', ... team letter + member index). */
  seat: string;
  /** Live players only (who may read the record; the UI finds "you" by it). */
  userId?: string;
  name: string;
  /** '' when the hero was never picked. */
  heroId: string;
  /** The board it last fought with (null = none was recorded). */
  board: MatchBoard | null;
}

export interface DuosHistoryTeam {
  team: string;
  /** The team's name (Ranked Duos teams that named themselves). */
  name?: string;
  kind: DuosHistoryTeamKind;
  /** Final team placement (1 = won). Absent = still standing when the game ended. */
  placement?: number;
  /** The round the team went out. */
  outRound?: number;
  members: DuosHistoryMember[];
}

export interface DuosHistoryRecord {
  v: 1;
  mode: DuosHistoryMode;
  /** The round the game ended on. */
  endRound: number;
  startedAt?: string;
  endedAt?: string;
  /** Every team, ordered by placement (standing teams first after the winner, by placement after). */
  teams: DuosHistoryTeam[];
}

const BOARD_CAP = 7;
const RUNE_CAP = 12;
const TEAM_CAP = 4;
const MEMBER_CAP = 2;
const NAME_CAP = 40;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The card-render fields of one minion; null when it is not a minion. */
export function compactDuosMinion(v: unknown): BoardMinion | null {
  const o = obj(v);
  if (!o) return null;
  const cardId = str(o.cardId);
  const attack = num(o.attack);
  const health = num(o.health);
  if (!cardId || !ID_RE.test(cardId) || attack === undefined || health === undefined) return null;
  const m: BoardMinion = { cardId, attack, health };
  if (o.golden === true) m.golden = true;
  if (Array.isArray(o.keywords)) {
    const k = o.keywords.filter((x): x is Keyword => typeof x === 'string' && x.length <= 32).slice(0, 16);
    if (k.length) m.keywords = k;
  }
  if (Array.isArray(o.addedTribes)) {
    const t = o.addedTribes.filter((x): x is Tribe => typeof x === 'string' && x.length <= 32).slice(0, 4);
    if (t.length) m.addedTribes = t;
  }
  return m;
}

function runesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string' && ID_RE.test(id)).slice(0, RUNE_CAP) : [];
}

function boardOf(minions: unknown, tier: unknown, round: number, runes?: unknown): MatchBoard {
  const list = Array.isArray(minions) ? minions.slice(0, BOARD_CAP).map(compactDuosMinion).filter((m): m is BoardMinion => m !== null) : [];
  const out: MatchBoard = { round, tier: Math.max(1, Math.min(7, Math.round(num(tier) ?? 1))), minions: list };
  const r = runesOf(runes);
  if (r.length) out.runes = r;
  return out;
}

/** A Versus prepared side (`{ board, state: { tier } }`) as a stored board; null when it is not a side. */
export function duosBoardOfSide(side: unknown, round: number, runes?: unknown): MatchBoard | null {
  const s = obj(side);
  if (!s || !Array.isArray(s.board)) return null;
  return boardOf(s.board, obj(s.state)?.tier, round, runes);
}

/** A recorded run's board snapshot (`{ minions, tier, runes }`) as a stored board; null when it is not one. */
export function duosBoardOfSnapshot(snap: unknown, round: number): MatchBoard | null {
  const s = obj(snap);
  if (!s || !Array.isArray(s.minions)) return null;
  return boardOf(s.minions, s.tier, round, s.runes);
}

/** Teams in table order: by placement (a standing team, placement unknown, after the placed ones above it). */
export function orderDuosTeams<T extends Pick<DuosHistoryTeam, 'placement' | 'team'>>(teams: readonly T[]): T[] {
  const key = (t: T): number => t.placement ?? 1.5;
  return [...teams].sort((a, b) => key(a) - key(b) || a.team.localeCompare(b.team));
}

export function duosHistoryBytes(r: DuosHistoryRecord): number {
  return JSON.stringify(r).length;
}

/** Fit the record under the cap: recorded teams' boards go first (from the back), then any board. Pure. */
export function fitDuosHistory(r: DuosHistoryRecord, maxBytes = DUOS_HISTORY_MAX_BYTES): DuosHistoryRecord {
  if (duosHistoryBytes(r) <= maxBytes) return r;
  const out: DuosHistoryRecord = { ...r, teams: r.teams.map((t) => ({ ...t, members: t.members.map((m) => ({ ...m })) })) };
  const order = [...out.teams.filter((t) => t.kind !== 'live').reverse(), ...out.teams.filter((t) => t.kind === 'live').reverse()];
  for (const t of order) {
    for (const m of [...t.members].reverse()) {
      if (duosHistoryBytes(out) <= maxBytes) return out;
      if (m.board) m.board = { ...m.board, minions: [] };
    }
  }
  return out;
}

/** Build a record (clamps names, caps teams and members, orders the teams, fits the size). */
export function buildDuosHistory(input: {
  mode: DuosHistoryMode; endRound: number; startedAt?: string | null; endedAt?: string | null;
  teams: { team: string; name?: string | null; kind: DuosHistoryTeamKind; placement?: number | null; outRound?: number | null;
    members: { seat: string; userId?: string | null; name?: string | null; heroId?: string | null; board: MatchBoard | null }[] }[];
}): DuosHistoryRecord {
  const teams: DuosHistoryTeam[] = input.teams.slice(0, TEAM_CAP).map((t) => {
    const out: DuosHistoryTeam = {
      team: t.team, kind: t.kind,
      members: t.members.slice(0, MEMBER_CAP).map((m) => {
        const mm: DuosHistoryMember = { seat: m.seat, name: (m.name || 'Player').slice(0, NAME_CAP), heroId: m.heroId ?? '', board: m.board };
        if (m.userId) mm.userId = m.userId;
        return mm;
      }),
    };
    if (t.name) out.name = t.name.slice(0, NAME_CAP);
    if (typeof t.placement === 'number' && t.placement > 0) out.placement = t.placement;
    if (typeof t.outRound === 'number' && t.outRound > 0 && out.placement !== 1) out.outRound = t.outRound;
    return out;
  });
  const rec: DuosHistoryRecord = { v: 1, mode: input.mode, endRound: Math.max(0, input.endRound), teams: orderDuosTeams(teams) };
  if (input.startedAt) rec.startedAt = input.startedAt;
  if (input.endedAt) rec.endedAt = input.endedAt;
  return fitDuosHistory(rec);
}

// ── Reading a stored record back (tolerant: anything unreadable is dropped; no readable team = null) ─────────────────

function parseBoard(v: unknown): MatchBoard | null {
  const o = obj(v);
  if (!o || !Array.isArray(o.minions)) return null;
  return boardOf(o.minions, o.tier, num(o.round) ?? 0, o.runes);
}

function parseMember(v: unknown): DuosHistoryMember | null {
  const o = obj(v);
  const seat = str(o?.seat);
  if (!o || !seat) return null;
  const m: DuosHistoryMember = { seat, name: (str(o.name) ?? 'Player').slice(0, NAME_CAP), heroId: typeof o.heroId === 'string' ? o.heroId : '', board: parseBoard(o.board) };
  const u = str(o.userId);
  if (u) m.userId = u;
  return m;
}

function parseTeam(v: unknown): DuosHistoryTeam | null {
  const o = obj(v);
  const team = str(o?.team);
  if (!o || !team || !Array.isArray(o.members)) return null;
  const kind: DuosHistoryTeamKind = o.kind === 'duo' || o.kind === 'pair' || o.kind === 'generated' ? o.kind : 'live';
  const t: DuosHistoryTeam = { team, kind, members: o.members.slice(0, MEMBER_CAP).map(parseMember).filter((m): m is DuosHistoryMember => m !== null) };
  if (str(o.name)) t.name = str(o.name)!.slice(0, NAME_CAP);
  const p = num(o.placement);
  if (p !== undefined && p > 0) t.placement = p;
  const r = num(o.outRound);
  if (r !== undefined && r > 0) t.outRound = r;
  return t;
}

/** Read a stored record; null when absent or unreadable. Keeps the stored team order. */
export function parseDuosHistory(v: unknown): DuosHistoryRecord | null {
  const o = obj(v);
  if (!o || o.v !== DUOS_HISTORY_VERSION || !Array.isArray(o.teams)) return null;
  const teams = o.teams.slice(0, TEAM_CAP).map(parseTeam).filter((t): t is DuosHistoryTeam => t !== null);
  if (!teams.length) return null;
  const rec: DuosHistoryRecord = { v: 1, mode: o.mode === 'ranked_duos' ? 'ranked_duos' : 'versus_duos', endRound: num(o.endRound) ?? 0, teams };
  if (str(o.startedAt)) rec.startedAt = str(o.startedAt);
  if (str(o.endedAt)) rec.endedAt = str(o.endedAt);
  return rec;
}
