/**
 * THE LIVE DIRECTORY — the rules (R-LIVE-DIR-01), with no Durable Object in sight. The object (`liveDirectory.ts`) owns
 * storage, the clock and the rank lookups; this decides what is listed, to whom, and in which order. It ports what the
 * Supabase listing did in SQL:
 *
 *   - `lobby_live_cf` / `versus_cf_live`: one row per game, cleaned and clamped; one live game per player (a player's
 *     other row goes); a row is listed `LIVE_DIR_TTL_MS` past its last write; a removal deletes it.
 *   - the read policy: a friends-only Versus room is seen only by its host and the host's friends (`lobby_live__may_see`).
 *   - the listing order: division, then points, then rating, best first (the client's `.order(...)` chain).
 *   - the glow count: games not ended (a head-only count under the read policy).
 *
 * Pure: the clock and the reader's friends are handed in.
 */
import {
  LIVE_DIR_MAX_ROWS, LIVE_DIR_PAGE, LIVE_DIR_TTL_MS,
  type LiveDirMode, type LiveDirPhase, type LiveDirPut, type LiveDirRank, type LiveDirRow,
} from '../liveDirProtocol';

/** What the directory keeps per game. */
export interface DirEntry {
  row: LiveDirRow;
  user: string;
  privateHost: string | null;
  team: string | null;
  /** Epoch ms past which the row is no longer listed. */
  until: number;
}

/** Who is reading: an account (with its friends, when a private row needs them) or a guest / nobody. */
export interface DirReader {
  userId: string | null;
  /** The reader's friends. Asked for only when a friends-only row is in play (`needsFriends`). */
  friends?: ReadonlySet<string> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GAME_ID = /^[!-~]{1,80}$/;
const MODES = new Set<LiveDirMode>(['casual', 'practice', 'duel', 'group', 'duos', 'ranked_duos']);
const PHASES = new Set<LiveDirPhase>(['hero', 'shop', 'combat']);

const int = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const text = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);
const uuidOrNull = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);
const objOrNull = (v: unknown, max: number): Record<string, unknown> | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  try { return JSON.stringify(v).length <= max ? (v as Record<string, unknown>) : null; } catch { return null; }
};

export class LiveDirError extends Error {
  constructor(readonly code: 'bad_game' | 'bad_row' | 'bad_phase' | 'bad_mode' | 'full') { super(code); }
}

/** A put, cleaned (the SQL writers' own bounds). Throws `LiveDirError`. */
export function cleanPut(raw: unknown): LiveDirPut {
  if (!raw || typeof raw !== 'object') throw new LiveDirError('bad_row');
  const r = raw as Record<string, unknown>;
  const game = String(r.game_id ?? '');
  if (!GAME_ID.test(game)) throw new LiveDirError('bad_game');
  const user = uuidOrNull(r.user_id);
  if (!user) throw new LiveDirError('bad_row');
  if (!PHASES.has(r.phase as LiveDirPhase)) throw new LiveDirError('bad_phase');
  const mode = r.mode == null ? null : (r.mode as LiveDirMode);
  if (mode != null && !MODES.has(mode)) throw new LiveDirError('bad_mode');
  const host = r.live_host == null ? null : String(r.live_host);
  // `cf:<revision>`: a game on that revision's Versus Worker; `session`: a game hosted by its session on this hub (R-SESSION-CF-01).
  if (host != null && host !== 'session' && !/^cf:[0-9A-Za-z._-]{1,64}$/.test(host)) throw new LiveDirError('bad_row');
  return {
    game_id: game, user_id: user,
    display_name: text(r.display_name, 40) || (mode === 'ranked_duos' ? 'Duo' : 'Player'),
    hero_id: text(r.hero_id, 60) || 'warden',
    cosmetics: objOrNull(r.cosmetics, 4096),
    round: int(r.round, 1, 200, 1), phase: r.phase as LiveDirPhase, spectators: int(r.spectators, 0, 99, 0),
    mode, players: text(r.players, 160) || null, live_host: host, status: objOrNull(r.status, 1024),
    private_host: uuidOrNull(r.private_host), team: uuidOrNull(r.team),
    started_at: typeof r.started_at === 'string' && Number.isFinite(Date.parse(r.started_at)) ? r.started_at : null,
    replaces: Array.isArray(r.replaces) ? r.replaces.filter((x): x is string => typeof x === 'string' && GAME_ID.test(x) && x !== game).slice(0, 4) : [],
    division_index: int(r.division_index, 0, 999, 0), rank_points: int(r.rank_points, 0, 1_000_000, 0), rating: int(r.rating, 0, 1_000_000, 0),
  };
}

/** The listing order: division, then points, then rating, best first; the game id breaks a tie (a stable page). */
export function compareRows(a: LiveDirRow, b: LiveDirRow): number {
  return b.division_index - a.division_index || b.rank_points - a.rank_points || b.rating - a.rating
    || (a.game_id < b.game_id ? -1 : a.game_id > b.game_id ? 1 : 0);
}

export class LiveDirCore {
  readonly entries = new Map<string, DirEntry>();
  /** The sorted rows, rebuilt only after a change (a read never sorts). */
  private sorted: DirEntry[] | null = null;

  /**
   * Register (or refresh) one game. `rank`: the looked-up rank of the row's owner (a lobby game, a Versus room's first
   * seat) or team (Ranked Duos), or null (the writer's own values stand). Returns the ids removed alongside it.
   */
  put(p: LiveDirPut, rank: LiveDirRank | null, now: number): string[] {
    const removed: string[] = [];
    // One live game per player: the player's other row goes (as the SQL writers did), and anything it replaces.
    for (const [id, e] of this.entries) if (id !== p.game_id && (e.user === p.user_id || p.replaces?.includes(id))) removed.push(id);
    for (const id of removed) this.entries.delete(id);
    const prev = this.entries.get(p.game_id);
    if (!prev && this.entries.size >= LIVE_DIR_MAX_ROWS) {
      this.purge(now);
      if (this.entries.size >= LIVE_DIR_MAX_ROWS) throw new LiveDirError('full');
    }
    const duo = p.mode === 'ranked_duos';
    const division = rank ? rank.division : p.division_index ?? 0;
    const points = rank ? rank.points : p.rank_points ?? 0;
    const rating = duo ? 100 * division + points : rank ? rank.rating : p.rating ?? 0;
    const name = duo ? (text(rank?.name, 40) || p.players?.slice(0, 40) || p.display_name || 'Duo') : p.display_name;
    const started = prev && prev.user === p.user_id ? prev.row.started_at : p.started_at ?? new Date(now).toISOString();
    this.entries.set(p.game_id, {
      user: p.user_id, privateHost: duo ? null : p.private_host, team: p.team, until: now + LIVE_DIR_TTL_MS,
      row: {
        game_id: p.game_id, display_name: name, hero_id: p.hero_id, cosmetics: p.cosmetics,
        division_index: division, rank_points: points, rating,
        round: p.round, phase: p.phase, placement: null, spectators: p.spectators, started_at: started,
        mode: p.mode, players: p.players, live_host: p.live_host, status: p.status,
      },
    });
    this.sorted = null;
    return removed;
  }

  /** The game ended or its room closed. True when a row was there. */
  remove(gameId: string): boolean {
    const had = this.entries.delete(gameId);
    if (had) this.sorted = null;
    return had;
  }

  /** Drop the rows past their time. Returns the ids dropped. */
  purge(now: number): string[] {
    const gone: string[] = [];
    for (const [id, e] of this.entries) if (e.until <= now) gone.push(id);
    for (const id of gone) this.entries.delete(id);
    if (gone.length) this.sorted = null;
    return gone;
  }

  /** When the next row runs out (the purge alarm), or null. */
  nextExpiry(): number | null {
    let at: number | null = null;
    for (const e of this.entries.values()) if (at == null || e.until < at) at = e.until;
    return at;
  }

  /** Does reading for this account need its friends (a friends-only row it does not host is listed)? */
  needsFriends(userId: string | null, now: number): boolean {
    if (!userId) return false;
    for (const e of this.entries.values()) if (e.until > now && e.privateHost && e.privateHost !== userId) return true;
    return false;
  }

  /** May this reader see the entry? (The SQL read policy: listed, and public or mine or my friend's.) */
  visible(e: DirEntry, reader: DirReader, now: number): boolean {
    if (e.until <= now) return false;
    if (!e.privateHost) return true;
    if (!reader.userId) return false;
    return reader.userId === e.privateHost || !!reader.friends?.has(e.privateHost);
  }

  private order(): DirEntry[] {
    if (!this.sorted) this.sorted = [...this.entries.values()].sort((a, b) => compareRows(a.row, b.row));
    return this.sorted;
  }

  /** One page, best rank first. */
  list(reader: DirReader, page: number, now: number): LiveDirRow[] {
    const p = Math.max(0, Math.min(1000, Math.floor(page) || 0));
    const out: LiveDirRow[] = [];
    let skip = p * LIVE_DIR_PAGE;
    for (const e of this.order()) {
      if (!this.visible(e, reader, now)) continue;
      if (skip > 0) { skip--; continue; }
      out.push(e.row);
      if (out.length >= LIVE_DIR_PAGE) break;
    }
    return out;
  }

  /** Games in progress the reader may see (an ended game is left out). */
  count(reader: DirReader, now: number): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.row.phase !== 'end' && this.visible(e, reader, now)) n++;
    return n;
  }

  /** One game's row, or null (gone, run out, or not visible to this reader). */
  game(gameId: string, reader: DirReader, now: number): LiveDirRow | null {
    const e = this.entries.get(gameId);
    return e && this.visible(e, reader, now) ? e.row : null;
  }
}
