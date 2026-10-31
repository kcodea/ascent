/**
 * THE LIVE DIRECTORY — the wire of Live Games on the friends hub (owner 2026-10-30: "I want us to make cloudflare work as
 * our source for live information and action like spectating"; R-LIVE-DIR-01).
 *
 * The Versus Worker is deployed once per content revision, so its own directory only knows its own revision's games. The
 * Live Games list spans every revision, so it lives on the ONE version-independent Worker, `ascent-hub`
 * (`liveDirectory.ts`). Every revision's rooms and live lobby games register into it through a service binding to the
 * hub's `LiveDirectoryWriter` entrypoint (Worker to Worker; the public internet cannot reach it), and clients read it
 * over plain HTTP:
 *
 *   GET /live/games?page=N   one page of `LIVE_DIR_PAGE` rows, best rank first (medal + division, points, rating)
 *   GET /live/count          `{ count }`: games in progress the caller may see (the menu glow)
 *   GET /live/game/<id>      one row, or null (a friend's Watch: which Worker hosts it)
 *
 * The rows have the `LiveGameRow` shape the Supabase listing had, so the client's screens are unchanged.
 *
 * Dependency-free: no imports (the UI imports it).
 */

/** The listing's page size (the Live Games page shows this many at once). */
export const LIVE_DIR_PAGE = 30;
/** A row stays listed this long past its last write (the writers keep it alive every 2 minutes). */
export const LIVE_DIR_TTL_MS = 4 * 60_000;
/** How long the directory trusts a looked-up rank or team before reading it again. */
export const LIVE_DIR_META_TTL_MS = 10 * 60_000;
/** The most rows the directory keeps (a runaway writer can never grow it without bound). */
export const LIVE_DIR_MAX_ROWS = 2_000;

export const LIVE_DIR_ROUTES = {
  games: '/live/games',
  count: '/live/count',
  game: '/live/game/',
} as const;

export type LiveDirMode = 'casual' | 'practice' | 'duel' | 'group' | 'duos' | 'ranked_duos';
export type LiveDirPhase = 'hero' | 'shop' | 'combat';

/**
 * What a Worker registers (one live game). Rank, medal and rating are looked up by the directory (cached); the values a
 * writer carries are only the fallback when that lookup cannot be made.
 */
export interface LiveDirPut {
  game_id: string;
  /** The row's owner (one live game per player, as the Supabase rows). */
  user_id: string;
  display_name: string;
  hero_id: string;
  cosmetics: Record<string, unknown> | null;
  round: number;
  phase: LiveDirPhase;
  spectators: number;
  /** null = a ranked lobby game. */
  mode: LiveDirMode | null;
  /** The players' line of a Versus match ("Ann vs Bob"). */
  players: string | null;
  /** `cf:<content revision>` for a lobby game (watch it on that Worker); null for a Versus room (its id says `cf:`). */
  live_host: string | null;
  /** A lobby game at a glance (R-LIVE-STATUS-01), or null. */
  status: Record<string, unknown> | null;
  /** A friends-only Versus room's host: only the host and the host's friends see the row. */
  private_host: string | null;
  /** Ranked Duos: the team (its name and medal are looked up). */
  team: string | null;
  /** When the game started (ISO); the directory keeps the first one it saw when absent. */
  started_at?: string | null;
  /** Other ids this game replaces (a room that changed mode): removed in the same write. */
  replaces?: string[];
  /** Fallbacks (a lobby game's own report; a Ranked Duos room's team division). */
  division_index?: number;
  rank_points?: number;
  rating?: number;
}

/** One row as a client reads it (the Supabase `lobby_live_games` read shape). */
export interface LiveDirRow {
  game_id: string;
  display_name: string;
  hero_id: string;
  cosmetics: Record<string, unknown> | null;
  division_index: number;
  rank_points: number;
  rating: number;
  round: number;
  phase: LiveDirPhase | 'end';
  placement: number | null;
  spectators: number;
  started_at: string;
  mode: LiveDirMode | null;
  players: string | null;
  live_host: string | null;
  status: Record<string, unknown> | null;
}

/** The rank the directory looked up for an account or a team. */
export interface LiveDirRank {
  division: number;
  points: number;
  rating: number;
  /** A Ranked Duos team's name. */
  name?: string | null;
}
