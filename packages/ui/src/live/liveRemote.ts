/**
 * LIVE GAMES, the reads (owner-approved 2026-10-15). Since R-LIVE-CF-ONLY-01 (2026-10-30) nothing here writes, joins,
 * watches or subscribes: every live game publishes and is watched on the Versus Worker (`liveCf.ts`).
 *
 * THE LIST IS ON CLOUDFLARE (R-LIVE-DIR-01, owner 2026-10-30: "I want us to make cloudflare work as our source for live
 * information and action like spectating"). The Live Games page, the menu glow and the one row a friend's Watch looks up
 * read the friends hub's live directory (`workers/versus/src/liveDirectory.ts`, one version-independent Worker that every
 * content revision's games register into), never Supabase. Each read is one small HTTP GET answered from the
 * directory's memory: no Supabase row is read for it. The rows keep the shape the Supabase listing had.
 *
 * What still comes from Supabase here is storage: the watched game's seat recordings (boards).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RunCosmeticSnapshot } from '@game/progression';
import type { BoardSnapshot } from '@game/sim';
import { LIVE_DIR_ROUTES } from '@game/versus-cf/liveDir';
import { supabaseClient } from '../remoteBoards';
import { fetchAllRows } from '../supabaseRows';
import { friendsHubUrl } from '../friends/dm/hubUrl';
import { sessionPath } from '@game/versus-cf/session';
import { hubToken } from '../friends/dm/hubToken';

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
  /** 'hero': the player is on Hero Select (R-SPECTATE-HEROSELECT-01). */
  phase: 'hero' | 'shop' | 'combat' | 'end';
  placement: number | null;
  spectators: number;
  started_at: string;
  /** EVERY GAME IS A LIVE GAME (owner 2026-10-28, R-LIVE-ALL-GAMES-01): null / absent = a ranked lobby game; 'casual' /
   *  'practice' = those lobby games; 'duel' / 'group' / 'duos' = a Versus match (`versus:<ref>`); 'ranked_duos' = a
   *  Ranked Duos team (`duos:<ref>`). */
  mode?: LiveGameMode | null;
  /** The players' line of a Versus match ("Ann vs Bob", "Ann & Bob vs Cat & Dan"). */
  players?: string | null;
  /** LIVE GAMES ON CLOUDFLARE (R-LIVE-CF-01): `cf:<content revision>`, the Worker that hosts the game (watch it there).
   *  Null / absent on a lobby row only from an older build on the retired Supabase path (R-LIVE-CF-ONLY-01): such a
   *  game cannot be watched. */
  live_host?: string | null;
  /** A LIVE GAME AT A GLANCE (R-LIVE-STATUS-01): the lobby player's game status in the Friends shape
   *  (`FriendGameStatus`). Read through `liveGameStatusOf`; absent on a Versus / Ranked Duos row or an older client. */
  status?: unknown;
}

export type LiveGameMode = 'casual' | 'practice' | 'duel' | 'group' | 'duos' | 'ranked_duos';

export class LiveError extends Error {
  constructor(readonly code: string, message?: string) { super(message ?? code); }
}
function fail(e: { message?: string; code?: string } | null | undefined): never {
  const msg = (e?.message ?? 'unknown').trim();
  if (e?.code === 'PGRST202' || e?.code === 'PGRST205' || e?.code === '42P01') throw new LiveError('not_deployed', msg);
  throw new LiveError(/^[a-z_]+$/.test(msg) ? msg : 'network', msg);
}

/** The listing's page size: the rows the Live games page shows at once (ranked best first). */
export const LIVE_PAGE = 30;

/** How the directory is reached (injectable for the tests). */
export interface LiveDirAccess {
  /** The hub's base URL, or null (this page has no hub: nothing is listed). */
  base: () => string | null;
  token: (base: string) => Promise<string>;
  fetch: (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

const defaultAccess: LiveDirAccess = {
  base: friendsHubUrl,
  token: hubToken,
  fetch: (url, init) => fetch(url, init),
};

export function makeLiveRemote(getClient: () => SupabaseClient | null, access: LiveDirAccess = defaultAccess) {
  /** One GET on the hub's directory. */
  async function dir<T>(path: string): Promise<T> {
    const base = access.base();
    if (!base) throw new LiveError('no_backend');
    let token: string;
    try { token = await access.token(base); } catch { throw new LiveError('not_signed_in'); }
    let res: Awaited<ReturnType<LiveDirAccess['fetch']>>;
    try {
      res = await access.fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new LiveError('network');
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const code = (body as { error?: unknown } | null)?.error;
      throw new LiveError(typeof code === 'string' && /^[a-z_]+$/.test(code) ? code : `http_${res.status}`);
    }
    return body as T;
  }
  const db = (): SupabaseClient => {
    const c = getClient();
    if (!c) throw new LiveError('no_backend');
    return c;
  };
  return {
    /** The live games, the best rank first (medal and division, then points, then rating). One page. */
    async list(page = 0): Promise<LiveGameRow[]> {
      const rows = await dir<LiveGameRow[] | null>(`${LIVE_DIR_ROUTES.games}?page=${Math.max(0, Math.floor(page))}`);
      return Array.isArray(rows) ? rows : [];
    },
    /** How many games are in progress (the side menu's Live Games glow). A finished game is left out. */
    async count(): Promise<number> {
      const r = await dir<{ count?: unknown } | null>(LIVE_DIR_ROUTES.count);
      const n = Number(r?.count);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    },
    /** One game's listing row (the watch screen's identity and end state), or null when it is gone. */
    async game(gameId: string): Promise<LiveGameRow | null> {
      return (await dir<LiveGameRow | null>(`${LIVE_DIR_ROUTES.game}${encodeURIComponent(gameId)}`)) ?? null;
    },
    /**
     * EVERY board of the runs with these seeds (R-SPECTATE-SEATS-01): the watched game's recorded seats, which the
     * watcher's own pool (sampled for the watcher's rank) usually lacks. Storage, so Supabase.
     */
    async seatRecordings(seeds: number[], via?: { sessionGame: string }): Promise<BoardSnapshot[]> {
      if (seeds.length === 0) return [];
      // A SESSION game (R-SESSION-CF-01): its session holds the table's recordings (pinned at the start). Only a session
      // that has none (an older client, a guest's table pin that never landed) falls through to the storage read below.
      if (via?.sessionGame) {
        const got = await dir<{ boards?: BoardSnapshot[] } | null>(sessionPath(via.sessionGame, 'seats')).catch(() => null);
        const want = new Set(seeds);
        const boards = (got?.boards ?? []).filter((b) => b && want.has(Number(b.seed)));
        if (boards.length) return boards;
      }
      const res = await fetchAllRows<{ snapshot: BoardSnapshot }>((from, to) => db().from('boards').select('snapshot')
        .in('seed', seeds).order('id', { ascending: true }).range(from, to));
      if (res.error || !res.data) fail(res.error);
      return res.data.map((r) => r.snapshot).filter((s): s is BoardSnapshot => !!s);
    },
  };
}

export type LiveRemote = ReturnType<typeof makeLiveRemote>;
export const liveRemote: LiveRemote = makeLiveRemote(supabaseClient);
