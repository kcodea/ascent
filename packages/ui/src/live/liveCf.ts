/**
 * LIVE GAMES ON CLOUDFLARE, the client's transport (2026-10-29, owner: "build the cloudflare spectating for lobby and
 * practice too so it's all uniform"; R-LIVE-CF-01). One WebSocket to the game's Durable Object on the Worker
 * (`workers/versus/src/liveGame.ts`), over the same client the Versus rooms use (`@game/versus-cf/client`: keep-alive,
 * reconnect, backoff), in place of the Supabase heartbeat RPC, broadcast channel, keyframe table, watcher RPCs and
 * listing polls:
 *
 *   - the PLAYER (`openCfPublisher`): its listing (round / phase / hero), its keyframe, its spectator stream and the end
 *     go up the socket; who watches comes down the moment it changes.
 *   - a WATCHER (`openCfWatcher`): the hello brings the game's row, its keyframe and the stands; the stream, the row as
 *     it changes, the stands and the end come down the socket. Nothing is polled.
 *
 * Supabase sees none of it: the object writes the Live Games row (event-driven) and the watch record for the spectators'
 * XP through its own key-gated writers. A Worker that cannot be reached within `CF_OPEN_TIMEOUT_MS` fails the open (the
 * player then publishes on Supabase instead; see `livePublisher.ts`).
 */
import { VersusCfClient, VersusCfError, type WebSocketLike } from '@game/versus-cf/client';
import { LIVE_CF_PROTOCOL, liveCfSocketPath, type LiveHelloAnswer, type LivePush, type LiveRow, type LiveWatcher } from '@game/versus-cf/live';
import { contentRevision } from '@game/content';
import { VERSUS_PROTOCOL } from '@game/sim';
import { supabaseClient } from '../remoteBoards';
import { currentUserId } from '../identity';

/** How long a first open may take before the Worker counts as unreachable. */
export const CF_OPEN_TIMEOUT_MS = 6000;

export type { LiveRow, LiveWatcher, LiveHelloAnswer };

/** The listing the player sends (the Live Games row; rank is read in SQL). */
export interface CfListing {
  name: string;
  hero: string;
  cosmetics: unknown;
  round: number;
  phase: 'hero' | 'shop' | 'combat';
  mode: 'ranked' | 'casual' | 'practice';
  division?: number;
  points?: number;
  rating?: number;
  /** The game at a glance (R-LIVE-STATUS-01): the Friends status shape, or null on Hero Select. */
  status?: unknown;
}

/** The socket seam (tests replace it). */
export interface CfLiveSocket {
  connect(): Promise<void>;
  request<T = unknown>(op: 'listing' | 'key' | 'end', args?: Record<string, unknown>): Promise<T>;
  broadcast(event: string, payload: unknown): void;
  close(): void;
}

export interface CfSocketOptions {
  baseUrl: string;
  gameId: string;
  hello: Record<string, unknown>;
  onHello: (a: LiveHelloAnswer) => void;
  onPush: (m: LivePush) => void;
  onDead: (reason: string) => void;
}

/** The access token (or, against a dev Worker with no session, a dev token naming this account). */
async function token(): Promise<string> {
  try {
    const t = (await supabaseClient()?.auth.getSession())?.data.session?.access_token;
    if (t) return t;
  } catch { /* fall through */ }
  const me = currentUserId();
  if (!me) throw new VersusCfError('not_signed_in');
  return `dev.${me}.dev`;
}

const browserSocket = (opts: CfSocketOptions): CfLiveSocket => {
  const c = new VersusCfClient({
    baseUrl: opts.baseUrl, roomId: opts.gameId, path: liveCfSocketPath(opts.gameId), token,
    versusProtocol: VERSUS_PROTOCOL, contentRevision: contentRevision(),
    ws: (url, protocols) => new WebSocket(url, protocols) as unknown as WebSocketLike,
    hello: () => opts.hello,
    onHello: (d) => opts.onHello(d as LiveHelloAnswer),
    onPush: (m) => opts.onPush(m as unknown as LivePush),
    onStatus: (s, d) => { if (s === 'dead') opts.onDead(d ?? 'closed'); },
    wake: (fn) => { window.addEventListener('online', fn); return () => window.removeEventListener('online', fn); },
  });
  return {
    connect: () => c.connect(),
    request: (op, args = {}) => c.request(op, args),
    broadcast: (e, p) => c.broadcast(e, p),
    close: () => c.close(),
  };
};
let makeSocket: (o: CfSocketOptions) => CfLiveSocket = browserSocket;
/** Tests: a fake socket. */
export function setCfLiveSocketForTests(fn: ((o: CfSocketOptions) => CfLiveSocket) | null): void { makeSocket = fn ?? browserSocket; }

/** Open, or fail with `unreachable` after the timeout (the socket is then closed: nothing keeps retrying behind). */
async function openWithin(sock: CfLiveSocket): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      sock.connect(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new VersusCfError('unreachable')), CF_OPEN_TIMEOUT_MS); }),
    ]);
  } catch (e) {
    sock.close();
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── The player ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface CfPublisher {
  /** Send the listing; answers the watcher count. */
  listing(l: CfListing): Promise<number>;
  /** The latest keyframe (kept by the object for a late joiner; never relayed). */
  key(frame: unknown): void;
  /** The spectator stream / emotes / cursor (relayed to the stands). */
  send(event: string, payload: unknown): void;
  /** The game is over (a placement, or null: abandoned). */
  end(placement: number | null): Promise<void>;
  close(): void;
}

export interface CfPublisherHandlers {
  onWatchers: (list: LiveWatcher[]) => void;
  onBroadcast: (event: string, payload: unknown) => void;
  /** The socket is gone for good (another tab took the game, the game was ended). */
  onDead?: (reason: string) => void;
}

export async function openCfPublisher(baseUrl: string, gameId: string, h: CfPublisherHandlers): Promise<CfPublisher> {
  const sock = makeSocket({
    baseUrl, gameId,
    hello: { protocol: LIVE_CF_PROTOCOL, role: 'publish', contentRevision: contentRevision() },
    // After every (re)connect the stands as they are now.
    onHello: (a) => h.onWatchers(a.watchers ?? []),
    onPush: (m) => {
      if (m.t === 'watchers') h.onWatchers(m.list);
      else if (m.t === 'bc') h.onBroadcast(m.event, m.payload);
    },
    onDead: (r) => h.onDead?.(r),
  });
  await openWithin(sock);
  return {
    listing: async (l) => Number((await sock.request<{ watchers?: number }>('listing', { ...l })).watchers ?? 0),
    key: (frame) => { void sock.request('key', { frame }).catch(() => undefined); },
    send: (e, p) => sock.broadcast(e, p),
    end: async (placement) => { await sock.request('end', { placement }); },
    close: () => sock.close(),
  };
}

// ── A watcher ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CfWatcher {
  send(event: string, payload: unknown): void;
  close(): void;
}

export interface CfWatcherHandlers {
  onBroadcast: (event: string, payload: unknown) => void;
  onRow: (row: LiveRow) => void;
  onWatchers: (list: LiveWatcher[]) => void;
  onEnd: (end: { placement: number | null; abandoned: boolean; row: LiveRow | null }) => void;
  onDead: (reason: string) => void;
}

/** Join a game's stands. Resolves with the hello (the row, the keyframe, the stands); rejects with the refusal's code. */
export async function openCfWatcher(baseUrl: string, gameId: string, me: { name: string; profile: Record<string, unknown> }, h: CfWatcherHandlers): Promise<{ watcher: CfWatcher; hello: LiveHelloAnswer }> {
  let first: LiveHelloAnswer | null = null;
  const sock = makeSocket({
    baseUrl, gameId,
    hello: { protocol: LIVE_CF_PROTOCOL, role: 'watch', name: me.name, profile: me.profile },
    onHello: (a) => {
      if (!first) { first = a; return; }
      // A reconnect: the row and the stands as they are now.
      if (a.row) h.onRow(a.row);
      h.onWatchers(a.watchers ?? []);
    },
    onPush: (m) => {
      if (m.t === 'bc') h.onBroadcast(m.event, m.payload);
      else if (m.t === 'row') h.onRow(m.row);
      else if (m.t === 'watchers') h.onWatchers(m.list);
      else if (m.t === 'end') h.onEnd({ placement: m.placement, abandoned: m.abandoned, row: m.row });
    },
    onDead: (r) => h.onDead(r),
  });
  await openWithin(sock);
  return { watcher: { send: (e, p) => sock.broadcast(e, p), close: () => sock.close() }, hello: first! };
}

/** The error code of a failed open (`spectators_full`, `no_game`, `own_game`, `unreachable`, ...). */
export const cfErrorCode = (e: unknown): string => (e instanceof VersusCfError ? e.code : 'network');
