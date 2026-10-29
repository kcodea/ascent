/**
 * LIVE GAMES ON CLOUDFLARE — one live lobby / Practice game's rules (R-LIVE-CF-01). Pure: no I/O, the clock is passed
 * in. The Durable Object (`liveGame.ts`) is the shell around it: sockets, storage, the alarm, the writers.
 *
 * The game is OWNED by the first account that publishes it (its player); nobody else can publish, list or end it. A
 * watcher may not be its player, and the stands hold at most `LIVE_WATCHER_CAP` accounts (one socket each). The game
 * ends when its player says so (a placement, or abandoned), or when the player has been gone `LIVE_PUBLISHER_GRACE_MS`
 * (abandoned: a reload inside that window just resumes). An object with nobody connected forgets itself after
 * `LIVE_IDLE_MS`; an ended one as soon as its row removal is written and everyone has gone.
 */
import {
  LIVE_IDLE_MS,
  LIVE_PUBLISHER_GRACE_MS,
  LIVE_STATUS_MAX_CHARS,
  LIVE_WATCHER_CAP,
  liveHostOf,
  type LiveGameInfo,
  type LiveRow,
  type LiveWatcher,
} from '../liveProtocol';
import type { WatchBeat } from '../spectate';

/** What the object keeps in storage (one small value, written when it changes). */
export interface LiveMeta {
  gameId: string;
  owner: string | null;
  contentRevision: string;
  /** The first publish (the game's start, for the watch record). */
  startedAt: number;
  info: LiveGameInfo | null;
  end: { placement: number | null; abandoned: boolean; at: number } | null;
  /** When the player's last socket closed (null while one is open). */
  publisherGoneAt: number | null;
  /** The last time anyone was connected or anything happened. */
  activeAt: number;
}

/** The Live Games row the object writes (`lobby_live_cf`); rank, medal and rating are read in SQL. */
export interface LobbyListing {
  game: string;
  user: string;
  name: string;
  hero: string;
  cosmetics: Record<string, unknown> | null;
  round: number;
  phase: 'hero' | 'shop' | 'combat';
  mode: 'casual' | 'practice' | null;
  spectators: number;
  host: string;
  /** The game at a glance (R-LIVE-STATUS-01), or null. */
  status: Record<string, unknown> | null;
}

export class LiveError extends Error {
  constructor(readonly code: string) { super(code); }
}

export const newLiveMeta = (gameId: string, contentRevision: string, now: number): LiveMeta =>
  ({ gameId, owner: null, contentRevision, startedAt: now, info: null, end: null, publisherGoneAt: null, activeAt: now });

const clampName = (s: unknown, fallback: string): string => {
  const t = String(s ?? '').trim().slice(0, 40);
  return t || fallback;
};
const int = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** A publisher's listing, cleaned (anything odd is clamped or refused). */
export function cleanInfo(raw: unknown): LiveGameInfo {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const phase = r.phase === 'hero' || r.phase === 'combat' ? r.phase : 'shop';
  const mode = r.mode === 'casual' || r.mode === 'practice' ? r.mode : 'ranked';
  const cos = r.cosmetics && typeof r.cosmetics === 'object' && !Array.isArray(r.cosmetics) && JSON.stringify(r.cosmetics).length <= 4096
    ? (r.cosmetics as Record<string, unknown>) : null;
  const status = r.status && typeof r.status === 'object' && !Array.isArray(r.status) && JSON.stringify(r.status).length <= LIVE_STATUS_MAX_CHARS
    ? (r.status as Record<string, unknown>) : null;
  return {
    name: clampName(r.name, 'Player'), hero: String(r.hero ?? '').trim().slice(0, 60) || 'warden', cosmetics: cos,
    round: int(r.round, 1, 200, 1), phase, mode,
    division: int(r.division, 0, 999, 0), points: int(r.points, 0, 1_000_000, 0), rating: int(r.rating, 0, 1_000_000, 0),
    status,
  };
}

export class LiveCore {
  /** The stands: account → identity (rebuilt from the sockets after a wake). */
  readonly watchers = new Map<string, LiveWatcher>();
  /** Is the player connected right now (rebuilt from the sockets after a wake). */
  publisherHere = false;

  constructor(public meta: LiveMeta) {}

  // ── Who may connect ──────────────────────────────────────────────────────────────────────────────────────────

  /** The player opens (or re-opens) its game. Returns true when the meta changed. */
  publish(userId: string, now: number): void {
    const m = this.meta;
    if (m.owner && m.owner !== userId) throw new LiveError('not_owner');
    if (m.end) throw new LiveError('game_ended');
    if (!m.owner) { m.owner = userId; m.startedAt = now; }
    this.watchers.delete(userId);
    this.publisherHere = true;
    m.publisherGoneAt = null;
    m.activeAt = now;
  }

  /** A watcher joins (or re-joins: a reconnect never counts twice against the cap). */
  watch(userId: string, name: unknown, profile: unknown, now: number): LiveWatcher {
    const m = this.meta;
    if (!m.owner || !m.info) throw new LiveError('no_game');
    if (m.end) throw new LiveError('no_game');
    if (userId === m.owner) throw new LiveError('own_game');
    if (!this.watchers.has(userId) && this.watchers.size >= LIVE_WATCHER_CAP) throw new LiveError('spectators_full');
    const prof = profile && typeof profile === 'object' && !Array.isArray(profile) && JSON.stringify(profile).length <= 2048
      ? (profile as Record<string, unknown>) : null;
    const w: LiveWatcher = { user_id: userId, display_name: clampName(name, 'Spectator'), profile: prof };
    this.watchers.set(userId, w);
    m.activeAt = now;
    return w;
  }

  /** An account's last socket closed. Returns which role it held (null: neither). */
  gone(userId: string, now: number): 'publish' | 'watch' | null {
    this.meta.activeAt = now;
    if (userId === this.meta.owner && this.publisherHere) {
      this.publisherHere = false;
      this.meta.publisherGoneAt = now;
      return 'publish';
    }
    return this.watchers.delete(userId) ? 'watch' : null;
  }

  // ── The player's requests ────────────────────────────────────────────────────────────────────────────────────

  private mine(userId: string): void {
    if (userId !== this.meta.owner) throw new LiveError('not_owner');
  }

  listing(userId: string, raw: unknown, now: number): LiveGameInfo {
    this.mine(userId);
    if (this.meta.end) throw new LiveError('game_ended');
    this.meta.info = cleanInfo(raw);
    this.meta.activeAt = now;
    return this.meta.info;
  }

  /** The game ends: a placement (1..8), or abandoned (null). Idempotent: the first end stands. */
  end(userId: string | null, placement: unknown, now: number): boolean {
    if (userId != null) this.mine(userId);
    if (this.meta.end) return false;
    const p = placement == null ? null : int(placement, 1, 8, 0) || null;
    this.meta.end = { placement: p, abandoned: p == null, at: now };
    this.meta.activeAt = now;
    return true;
  }

  // ── Time ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The player has been gone past the grace: the game ends as abandoned. */
  publisherExpired(now: number): boolean {
    const m = this.meta;
    return !m.end && !!m.owner && !this.publisherHere && m.publisherGoneAt != null && now - m.publisherGoneAt >= LIVE_PUBLISHER_GRACE_MS;
  }

  /** Nobody is here and nothing is owed: the object may forget itself. `pending`: a row write is still owed. */
  idle(now: number, sockets: number, pending: boolean): boolean {
    if (pending || sockets > 0) return false;
    if (this.meta.end) return true;
    return now - this.meta.activeAt >= LIVE_IDLE_MS;
  }

  /** When the clock next matters (the grace, the idle), or null. */
  nextAt(sockets: number): number | null {
    const m = this.meta;
    const due: number[] = [];
    if (!m.end && m.owner && !this.publisherHere && m.publisherGoneAt != null) due.push(m.publisherGoneAt + LIVE_PUBLISHER_GRACE_MS);
    if (sockets === 0) due.push(m.end ? m.activeAt : m.activeAt + LIVE_IDLE_MS);
    return due.length ? Math.min(...due) : null;
  }

  // ── Views ────────────────────────────────────────────────────────────────────────────────────────────────────

  watcherList(): LiveWatcher[] {
    return [...this.watchers.values()];
  }

  /** The row a watcher sees (the Supabase listing's shape). Null before the player's first listing. */
  row(): LiveRow | null {
    const m = this.meta;
    const i = m.info;
    if (!i || !m.owner) return null;
    return {
      game_id: m.gameId, display_name: i.name, hero_id: i.hero, cosmetics: i.cosmetics,
      division_index: i.division ?? 0, rank_points: i.points ?? 0, rating: i.rating ?? 0,
      round: i.round, phase: m.end ? 'end' : i.phase, placement: m.end?.placement ?? null, spectators: this.watchers.size,
      started_at: new Date(m.startedAt).toISOString(), mode: i.mode === 'ranked' ? null : i.mode, live_host: liveHostOf(m.contentRevision),
      status: i.status ?? null,
    };
  }

  /** The Live Games row to write, or null (not listed yet, or over: the row is removed). */
  listingRow(): LobbyListing | null {
    const m = this.meta;
    const i = m.info;
    if (!i || !m.owner || m.end) return null;
    return {
      game: m.gameId, user: m.owner, name: i.name, hero: i.hero, cosmetics: i.cosmetics, round: i.round, phase: i.phase,
      mode: i.mode === 'ranked' ? null : i.mode, spectators: this.watchers.size, host: liveHostOf(m.contentRevision),
      status: i.status ?? null,
    };
  }

  /** One watcher's beat for the watch record. */
  beatFor(userId: string): WatchBeat {
    const m = this.meta;
    return { user: userId, kind: 'lobby', target: m.gameId, watched_user: m.owner, started_at: new Date(m.startedAt).toISOString(), ended: !!m.end };
  }

  /** Every watcher's beat. */
  beats(): WatchBeat[] {
    return [...this.watchers.keys()].map((u) => this.beatFor(u));
  }
}

/** What makes a Live Games row write due: it appearing / leaving, round, phase, hero, name, mode, and the status
 *  (R-LIVE-STATUS-01: the step, Health, tier... change a few times a round, and the player sends it at most once per
 *  listing, so it is a few small writes a round, never per frame). Not the stands. */
export const lobbyListingKey = (l: LobbyListing | null): string =>
  l ? `${l.game}|${l.user}|${l.round}|${l.phase}|${l.hero}|${l.name}|${l.mode ?? ''}|${l.host}|${l.status ? JSON.stringify(l.status) : ''}` : 'none';
