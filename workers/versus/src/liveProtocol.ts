/**
 * LIVE GAMES ON CLOUDFLARE — the wire protocol of one live lobby / Practice game's Durable Object (2026-10-29, owner:
 * "build the cloudflare spectating for lobby and practice too so it's all uniform"; R-LIVE-CF-01).
 *
 * The same framing as a Versus room (`protocol.ts`): one WebSocket per client per game (`GET /live/<game>/ws`), the
 * Supabase access token in the subprotocol list, keep-alive `ping` answered without waking the object, requests (`req`
 * → `res` by id) and relays (`bc`). Two roles:
 *
 *   - the PUBLISHER (the player, one account per game: the first to publish owns it): sends its listing (`listing`), its
 *     latest keyframe (`key`, cached in memory for a late joiner, never relayed), its spectator stream (`bc`), and the
 *     end (`end`). It is told who watches the moment that changes (`watchers` push), so it publishes only while
 *     someone does, as on Supabase.
 *   - a WATCHER (cap `LIVE_WATCHER_CAP`): its hello answers the game's row, the cached keyframe and the stands; it
 *     receives the stream (`bc`), the row as it changes (`row`), the stands (`watchers`) and the end (`end`, pushed only
 *     after the watch record for that moment was written, so the spectator's XP settlement never races it).
 *
 * Dependency-free: no imports.
 */

/** Bump when a message shape changes (a client on another version is refused at hello, close 4409). */
export const LIVE_CF_PROTOCOL = 1;
/** Watchers per game (the Supabase cap, `lobby_live_watch`). */
export const LIVE_WATCHER_CAP = 20;
/** A game whose publisher has been gone this long ends as abandoned (Supabase: a row silent for 60 s is gone). */
export const LIVE_PUBLISHER_GRACE_MS = 60_000;
/** An object with no publisher and no watcher forgets itself after this long (idle self-destruct). */
export const LIVE_IDLE_MS = 5 * 60_000;
/** The largest status the object keeps (the SQL column's own bound, `2026-11-13-lobby-live-status.sql`). */
export const LIVE_STATUS_MAX_CHARS = 1024;
/** A keyframe larger than this is not cached (the room's spectator-frame bound is far below it). */
export const LIVE_MAX_KEY_CHARS = 1_000_000;

export type LiveRole = 'publish' | 'watch';
export type LiveListingPhase = 'hero' | 'shop' | 'combat';
export type LiveGameMode = 'ranked' | 'casual' | 'practice';

/** What the publisher says about its game (the Live Games row; rank, medal and rating are read in SQL). */
export interface LiveGameInfo {
  name: string;
  hero: string;
  cosmetics: Record<string, unknown> | null;
  round: number;
  phase: LiveListingPhase;
  mode: LiveGameMode;
  /** The publisher's own rank, shown on the watch screen (the SQL row reads the profile itself). */
  division?: number;
  points?: number;
  rating?: number;
  /** The game at a glance (R-LIVE-STATUS-01): the client's Friends status shape (step, foe, place, Health, Armor, tier),
   *  passed through opaque (an object of at most `LIVE_STATUS_MAX_CHARS`), or null. */
  status?: Record<string, unknown> | null;
}

/** One person in the stands. */
export interface LiveWatcher {
  user_id: string;
  display_name: string;
  profile: Record<string, unknown> | null;
}

/** The game's row as a watcher sees it: the `LiveGameRow` shape the Supabase listing returns. */
export interface LiveRow {
  game_id: string;
  display_name: string;
  hero_id: string;
  cosmetics: Record<string, unknown> | null;
  division_index: number;
  rank_points: number;
  rating: number;
  round: number;
  phase: 'hero' | 'shop' | 'combat' | 'end';
  placement: number | null;
  spectators: number;
  started_at: string;
  mode: 'casual' | 'practice' | null;
  live_host: string;
  /** The game at a glance (R-LIVE-STATUS-01), as the publisher sent it, or null (absent from an older Worker). */
  status?: Record<string, unknown> | null;
}

export interface LiveHello {
  protocol: number;
  role: LiveRole;
  /** My name and portrait, for the player's "Spectating" indicator (watchers). */
  name?: string;
  profile?: Record<string, unknown>;
  /** The engine's content revision (stamped on the row as `cf:<rev>`, so a watcher knows which Worker to reach). */
  contentRevision?: string;
}

/** The hello answer. */
export interface LiveHelloAnswer {
  role: LiveRole;
  userId: string;
  row: LiveRow | null;
  /** The latest keyframe (a watcher only). */
  key: unknown | null;
  watchers: LiveWatcher[];
}

export type LiveOp = 'hello' | 'listing' | 'key' | 'end';

/** Pushes specific to a live game (alongside `bc` relays and `closed`). */
export type LivePush =
  | { t: 'watchers'; list: LiveWatcher[]; n: number }
  | { t: 'row'; row: LiveRow }
  | { t: 'end'; placement: number | null; abandoned: boolean; row: LiveRow | null }
  | { t: 'bc'; event: string; payload: unknown; from: string }
  | { t: 'closed'; reason: string };

/** `/live/<game>/ws` */
export const liveCfSocketPath = (gameId: string): string => `/live/${encodeURIComponent(gameId)}/ws`;

/** A lobby game id as the listing and the watch record accept it (`spectate_beat`: printable ASCII, 1..80). */
export const LIVE_GAME_ID = /^[!-~]{1,80}$/;

/** The row's `live_host` for a game on this Worker. */
export const liveHostOf = (contentRevision: string): string => `cf:${contentRevision}`;
