/**
 * VERSUS ON CLOUDFLARE — the wire protocol between a client and its room's Durable Object (spike, 2026-10-28).
 *
 * One WebSocket per client per room (`GET /rooms/<id>/ws`, upgraded). The player's Supabase access token rides the
 * `Sec-WebSocket-Protocol` header as `bearer.<jwt>` next to `VERSUS_CF_SUBPROTOCOL` (a browser cannot set an
 * Authorization header on a WebSocket, and a token never goes in a URL). The first frame the client sends is `hello`
 * with its protocol + content revision; the object refuses a mismatch with close code 4409, so a client never plays a
 * fight resolved under rules it did not show (the Netlify-pack rule, extended to the Worker).
 *
 * Every client message is either a REQUEST (`req`, answered once by a `res` with the same `id`) or a BROADCAST relay
 * (`bc`, the spectator frames, cursors and emotes the Supabase build sent over a Realtime broadcast channel). The object
 * PUSHES state as it changes: `room`, `match`, `round` (a committed fight, sent in the same tick as the `match` that
 * moved to combat, so the fight is on every client one message after the round closes), and `priv` (the seat's own
 * hidden hero offer, only ever to that seat's sockets).
 *
 * Row shapes are the Supabase rows' (`versus__room_json`, `versus__match_json`, `versus_rounds`), so the existing
 * Versus store runs unchanged over either transport. Types here are deliberately loose (`Record<string, unknown>`):
 * the UI adapter casts them to its own row types; this module must stay dependency-free (it is imported by the UI).
 *
 * Dependency-free: no imports.
 */

/** Bump when a message shape changes. A client on another version is refused at `hello` (close 4409). */
export const VERSUS_CF_PROTOCOL = 1;
/** The WebSocket subprotocol a client offers (the server echoes it back). */
export const VERSUS_CF_SUBPROTOCOL = 'ascent-versus.v1';
/** The subprotocol prefix carrying the bearer token (`bearer.<jwt>`). */
export const VERSUS_CF_BEARER_PREFIX = 'bearer.';

/** Close codes the object uses (4000-4999 is the application range). */
export const VERSUS_CF_CLOSE = {
  /** The client's protocol or content revision differs from the Worker's engine. */
  versionMismatch: 4409,
  /** The token was missing, expired or invalid. */
  unauthorized: 4401,
  /** The room no longer exists (everyone left). */
  roomClosed: 4404,
  /** The same account opened a newer socket on this room (one live socket per account per room). */
  replaced: 4000,
} as const;

/** The text frame a client sends as a keep-alive. The object answers it WITHOUT waking (hibernation auto-response). */
export const VERSUS_CF_PING = 'ping';
export const VERSUS_CF_PONG = 'pong';
/** How often a client pings, and how stale an auto-response may get before the object treats the socket as gone
 *  (a half-open TCP connection on a phone never fires `close`). */
export const VERSUS_CF_PING_MS = 5_000;
export const VERSUS_CF_STALE_MS = 15_000;

export type VersusCfOp =
  | 'hello'
  | 'join'
  | 'take_seat'
  | 'leave'
  | 'start'
  | 'gate'
  | 'set_options'
  | 'reconcile_room'
  | 'register_offer'
  | 'pick_hero'
  | 'reroll_hero'
  | 'submit'
  | 'unready'
  | 'intro_done'
  | 'combat_ready'
  | 'forfeit'
  | 'unpause'
  | 'request_resume'
  | 'reconcile'
  | 'heartbeat'
  | 'publish_frame'
  | 'latest_frames'
  | 'rounds'
  | 'my_private'
  | 'my_checkpoint'
  | 'sync';

export interface VersusCfHello {
  protocol: number;
  /** The engine's Versus wire protocol (`VERSUS_PROTOCOL` in @game/sim). */
  versusProtocol: number;
  contentRevision: string;
}

export interface VersusCfRequest {
  t: 'req';
  id: number;
  op: VersusCfOp;
  args?: Record<string, unknown>;
}

export interface VersusCfClientBroadcast {
  t: 'bc';
  event: string;
  payload: unknown;
}

export type VersusCfClientMessage = VersusCfRequest | VersusCfClientBroadcast;

export type VersusCfResponse =
  | { t: 'res'; id: number; ok: true; data: unknown; now: string }
  | { t: 'res'; id: number; ok: false; error: string; now: string };

export type VersusCfPush =
  | { t: 'room'; room: Record<string, unknown>; now: string }
  | { t: 'match'; match: Record<string, unknown>; now: string }
  | { t: 'round'; row: Record<string, unknown>; now: string }
  | { t: 'priv'; priv: Record<string, unknown>; now: string }
  | { t: 'bc'; event: string; payload: unknown; from: string }
  | { t: 'closed'; reason: string };

export type VersusCfServerMessage = VersusCfResponse | VersusCfPush;

/** HTTP routes on the Worker (everything else is a 404). */
export const VERSUS_CF_ROUTES = {
  health: '/health',
  /** POST: create a room (body: name, display, profile, setId, contentRevision, protocol, options). */
  rooms: '/rooms',
  /** GET: the open-room counts for the menus. */
  openRooms: '/rooms/open',
  /** GET: the caller's room id, if any. */
  myRoom: '/me/room',
} as const;

/** `/rooms/<id>/ws` */
export const versusCfSocketPath = (roomId: string): string => `/rooms/${encodeURIComponent(roomId)}/ws`;

export function parseServerMessage(text: string): VersusCfServerMessage | null {
  try {
    const m = JSON.parse(text) as VersusCfServerMessage;
    return m && typeof m === 'object' && typeof (m as { t?: unknown }).t === 'string' ? m : null;
  } catch {
    return null;
  }
}

export function parseClientMessage(text: string): VersusCfClientMessage | null {
  try {
    const m = JSON.parse(text) as VersusCfClientMessage;
    if (!m || typeof m !== 'object') return null;
    if (m.t === 'req' && Number.isInteger(m.id) && typeof m.op === 'string') return m;
    if (m.t === 'bc' && typeof m.event === 'string') return m;
    return null;
  } catch {
    return null;
  }
}
