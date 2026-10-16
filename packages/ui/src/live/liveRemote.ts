/**
 * LIVE RANKED LOBBY GAMES, the network seam (owner-approved 2026-10-15; SQL: `2026-10-15-lobby-live.sql`). The listing
 * table, the watcher RPCs, the latest keyframe, and one Realtime BROADCAST channel per game (`lobbylive:<game id>`)
 * that carries the spectator deltas, action tags and cursor (the Versus protocol, `versus/spectatorView.ts`).
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { RunCosmeticSnapshot } from '@game/progression';
import type { BoardSnapshot } from '@game/sim';
import { supabaseClient } from '../remoteBoards';
import { fetchAllRows } from '../supabaseRows';

/** One live game as the listing shows it (public columns only; never run state). */
export interface LiveGameRow {
  game_id: string;
  display_name: string;
  hero_id: string;
  cosmetics: RunCosmeticSnapshot | null;
  division_index: number;
  rank_points: number;
  rating: number;
  round: number;
  phase: 'shop' | 'combat' | 'end';
  placement: number | null;
  spectators: number;
  started_at: string;
}

export class LiveError extends Error {
  constructor(readonly code: string, message?: string) { super(message ?? code); }
}
const KNOWN = /^[a-z_]+$/;
function fail(e: { message?: string; code?: string } | null | undefined): never {
  const msg = (e?.message ?? 'unknown').trim();
  // The tables / functions are not on this server yet (PostgREST: unknown function / relation).
  if (e?.code === 'PGRST202' || e?.code === 'PGRST205' || e?.code === '42P01') throw new LiveError('not_deployed', msg);
  throw new LiveError(KNOWN.test(msg) ? msg : 'network', msg);
}

/** The listing's page size: the rows the Live games page shows at once (ranked best first). */
export const LIVE_PAGE = 30;

export function makeLiveRemote(getClient: () => SupabaseClient | null) {
  const db = (): SupabaseClient => {
    const c = getClient();
    if (!c) throw new LiveError('no_backend');
    return c;
  };
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    // rows: every lobby_live_* RPC returns a scalar, nothing, or one row (the watched game).
    const { data, error } = await db().rpc(fn, args);
    if (error) fail(error);
    return data as T;
  }
  return {
    /** The live games, the best rank first (medal and division, then points, then rating). One page. */
    async list(page = 0): Promise<LiveGameRow[]> {
      // rows: one page of LIVE_PAGE (R-NET-01); stale rows are filtered by the read policy.
      const { data, error } = await db().from('lobby_live_games')
        .select('game_id, display_name, hero_id, cosmetics, division_index, rank_points, rating, round, phase, placement, spectators, started_at')
        .order('division_index', { ascending: false }).order('rank_points', { ascending: false }).order('rating', { ascending: false })
        .range(page * LIVE_PAGE, page * LIVE_PAGE + LIVE_PAGE - 1);
      if (error) fail(error);
      return (data as LiveGameRow[]) ?? [];
    },
    /** One game's listing row (the watch screen's identity and end state), or null when it is gone. */
    async game(gameId: string): Promise<LiveGameRow | null> {
      const { data, error } = await db().from('lobby_live_games')
        .select('game_id, display_name, hero_id, cosmetics, division_index, rank_points, rating, round, phase, placement, spectators, started_at')
        .eq('game_id', gameId).maybeSingle();
      if (error) fail(error);
      return (data as LiveGameRow | null) ?? null;
    },
    /** The player registers / refreshes its game; returns the live watcher count. */
    heartbeat: (game: { gameId: string; name: string; heroId: string; cosmetics: RunCosmeticSnapshot | null; round: number; phase: 'shop' | 'combat' | 'end' }) =>
      rpc<number>('lobby_live_heartbeat', { p_game: game.gameId, p_name: game.name, p_hero: game.heroId, p_cosmetics: game.cosmetics, p_round: game.round, p_phase: game.phase }),
    end: (gameId: string, placement: number | null) => rpc<void>('lobby_live_end', { p_game: gameId, p_placement: placement }),
    publishFrame: (gameId: string, seq: number, round: number, frame: unknown) =>
      rpc<void>('lobby_live_publish_frame', { p_game: gameId, p_seq: seq, p_round: round, p_frame: frame }),
    async latestFrame(gameId: string): Promise<unknown | null> {
      const { data, error } = await db().from('lobby_live_frames').select('frame').eq('game_id', gameId).maybeSingle();
      if (error) fail(error);
      return (data as { frame: unknown } | null)?.frame ?? null;
    },
    watch: (gameId: string) => rpc<LiveGameRow>('lobby_live_watch', { p_game: gameId }),
    /**
     * Watch (or refresh) WITH the watcher's identity, so the player's top-left indicator can show who it is
     * (R-SPECTATE-WATCHERS-01; SQL `2026-10-15-lobby-live-watcher-identity.sql`). A server without that migration
     * answers `not_deployed`, and the plain `watch` is used instead (the player then sees a plain "Spectator").
     */
    async watchAs(gameId: string, name: string, profile: Record<string, unknown>): Promise<LiveGameRow> {
      try {
        return await rpc<LiveGameRow>('lobby_live_watch_as', { p_game: gameId, p_name: name, p_profile: profile });
      } catch (e) {
        if ((e as LiveError).code !== 'not_deployed') throw e;
        return rpc<LiveGameRow>('lobby_live_watch', { p_game: gameId });
      }
    },
    /** The PLAYER's own game's live watchers (name + profile), or null on a server without the identity migration. */
    async watchers(gameId: string): Promise<{ user_id: string; display_name: string; profile: Record<string, unknown> | null }[] | null> {
      try {
        // rows: at most 20 (the watcher cap, enforced in SQL) (R-NET-01).
        return (await rpc<{ user_id: string; display_name: string; profile: Record<string, unknown> | null }[] | null>('lobby_live_watchers', { p_game: gameId })) ?? [];
      } catch (e) {
        if ((e as LiveError).code === 'not_deployed') return null;
        throw e;
      }
    },
    unwatch: (gameId: string) => rpc<void>('lobby_live_unwatch', { p_game: gameId }),
    /**
     * EVERY board of the runs with these seeds (R-SPECTATE-SEATS-01): the watched game's recorded seats, which the
     * watcher's own pool (sampled for the watcher's rank) usually lacks. Every patch: the run is whatever the player's
     * client seated. The caller keeps only the boards of the run keys it asked for.
     */
    async seatRecordings(seeds: number[]): Promise<BoardSnapshot[]> {
      if (seeds.length === 0) return [];
      const res = await fetchAllRows<{ snapshot: BoardSnapshot }>((from, to) => db().from('boards').select('snapshot')
        .in('seed', seeds).order('id', { ascending: true }).range(from, to));
      if (res.error || !res.data) fail(res.error);
      return res.data.map((r) => r.snapshot).filter((s): s is BoardSnapshot => !!s);
    },
    /** The game's broadcast channel (both ends). */
    channel(gameId: string, onBroadcast: (event: string, payload: unknown) => void): { channel: RealtimeChannel; send: (event: string, payload: unknown) => void; close: () => void } {
      const c = db();
      const ch = c.channel(`lobbylive:${gameId}`, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: '*' }, (msg: { event: string; payload: unknown }) => onBroadcast(msg.event, msg.payload));
      ch.subscribe();
      return { channel: ch, send: (event, payload) => { void ch.send({ type: 'broadcast', event, payload }); }, close: () => { void c.removeChannel(ch); } };
    },
  };
}

export type LiveRemote = ReturnType<typeof makeLiveRemote>;
export const liveRemote: LiveRemote = makeLiveRemote(supabaseClient);
