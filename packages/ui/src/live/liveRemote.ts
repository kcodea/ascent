/**
 * LIVE GAMES, the Supabase READS that remain (owner-approved 2026-10-15). Since R-LIVE-CF-ONLY-01 (2026-10-30) nothing
 * here writes, joins, watches or subscribes: every live game publishes and is watched on the Versus Worker
 * (`liveCf.ts`), and the Worker writes each game's Live Games row itself (`lobby_live_cf` / `versus_cf_live`). What is
 * left is reading that listing (the Live Games page, the menu glow, the one row a friend's Watch looks up) and the
 * watched game's seat recordings (boards, which are storage). Moving the listing itself onto Cloudflare is the planned
 * follow-up (docs/versus-cf-cutover.md, "What still reads Supabase").
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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
  /** 'hero': the player is on Hero Select (R-SPECTATE-HEROSELECT-01; needs 2026-10-26-lobby-live-hero-select.sql). */
  phase: 'hero' | 'shop' | 'combat' | 'end';
  placement: number | null;
  spectators: number;
  started_at: string;
  /** EVERY GAME IS A LIVE GAME (owner 2026-10-28, R-LIVE-ALL-GAMES-01; 2026-11-08 SQL): null / absent = a ranked lobby
   *  game; 'casual' / 'practice' = those lobby games; 'duel' / 'group' / 'duos' = a Versus match (`versus:<ref>`);
   *  'ranked_duos' = a Ranked Duos team (`duos:<ref>`). Absent on a server without the migration. */
  mode?: LiveGameMode | null;
  /** The players' line of a Versus match ("Ann vs Bob", "Ann & Bob vs Cat & Dan"). */
  players?: string | null;
  /** LIVE GAMES ON CLOUDFLARE (R-LIVE-CF-01; 2026-11-10-lobby-live-cf.sql): `cf:<content revision>`, the Worker that hosts
   *  the game (watch it there). Null / absent on a lobby row only from an older build on the retired Supabase path
   *  (R-LIVE-CF-ONLY-01): such a game cannot be watched. */
  live_host?: string | null;
  /** A LIVE GAME AT A GLANCE (R-LIVE-STATUS-01; 2026-11-13-lobby-live-status.sql): the lobby player's game status in the
   *  Friends shape (`FriendGameStatus`: the step and whom it fights, place, Health, Armor, tier). Read through
   *  `liveGameStatusOf`; absent on a Versus / Ranked Duos row, an older client, or a server without the migration. */
  status?: unknown;
}

export type LiveGameMode = 'casual' | 'practice' | 'duel' | 'group' | 'duos' | 'ranked_duos';

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

const BASE_COLS = 'game_id, display_name, hero_id, cosmetics, division_index, rank_points, rating, round, phase, placement, spectators, started_at';
/** A column the server does not have yet (PostgREST passes Postgres' `undefined_column`). */
const missingColumn = (e: { code?: string } | null | undefined): boolean => e?.code === '42703' || e?.code === 'PGRST204';

export function makeLiveRemote(getClient: () => SupabaseClient | null) {
  /** The newest columns this server has: 3 = `status` too (2026-11-13), 2 = `live_host` too (2026-11-10), 1 = `mode` /
   *  `players` (2026-11-08), 0 = the original listing. A server without a migration is read with the columns it has
   *  from then on. */
  let colLevel = 3;
  const cols = (): string => [BASE_COLS, `${BASE_COLS}, mode, players`, `${BASE_COLS}, mode, players, live_host`, `${BASE_COLS}, mode, players, live_host, status`][colLevel]!;
  /** A read of the listing, retried with older columns on a server that lacks the new ones. */
  async function read<T>(q: (columns: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T> {
    let { data, error } = await q(cols());
    while (error && colLevel > 0 && missingColumn(error)) {
      colLevel -= 1;
      ({ data, error } = await q(cols()));
    }
    if (error) fail(error);
    return data as T;
  }
  const db = (): SupabaseClient => {
    const c = getClient();
    if (!c) throw new LiveError('no_backend');
    return c;
  };
  return {
    /** The live games, the best rank first (medal and division, then points, then rating). One page. */
    async list(page = 0): Promise<LiveGameRow[]> {
      // rows: one page of LIVE_PAGE (R-NET-01); stale rows are filtered by the read policy.
      const data = await read<LiveGameRow[] | null>((c) => db().from('lobby_live_games').select(c)
        .order('division_index', { ascending: false }).order('rank_points', { ascending: false }).order('rating', { ascending: false })
        .range(page * LIVE_PAGE, page * LIVE_PAGE + LIVE_PAGE - 1));
      return data ?? [];
    },
    /** How many ranked games are in progress (the side menu's Live Games glow): a head-only count, no rows (R-NET-01).
     *  A finished game (phase `end`) is left out; stale rows are filtered by the read policy. */
    async count(): Promise<number> {
      const { count, error } = await db().from('lobby_live_games').select('game_id', { count: 'exact', head: true }).neq('phase', 'end');
      if (error) fail(error);
      return count ?? 0;
    },
    /** One game's listing row (the watch screen's identity and end state), or null when it is gone. */
    async game(gameId: string): Promise<LiveGameRow | null> {
      return (await read<LiveGameRow | null>((c) => db().from('lobby_live_games').select(c).eq('game_id', gameId).maybeSingle())) ?? null;
    },
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
  };
}

export type LiveRemote = ReturnType<typeof makeLiveRemote>;
export const liveRemote: LiveRemote = makeLiveRemote(supabaseClient);
