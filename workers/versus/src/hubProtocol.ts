/**
 * THE FRIENDS HUB — the wire protocol of a player's presence + direct message hub (owner 2026-10-29: "start building in
 * game messaging"; "In game messaging should be direct messages through the friends list, click a friend and a chat
 * overlay pops up"; R-DM-01..05).
 *
 * One Durable Object per ACCOUNT (`hub:<userId>`), one WebSocket per open game (`GET /hub/ws`), the same framing as a
 * Versus room (`protocol.ts`): the Supabase access token in the subprotocol list, keep-alive `ping` answered without
 * waking the object, requests (`req` -> `res` by id). Guests are refused (a guest has no friends).
 *
 *   - `hello` (my presence): answers the friends of mine who are connected right now, with their presence.
 *   - `presence` (my presence changed): fanned out to my connected friends.
 *   - `send` (a direct message): checked (friends only, not blocked, size, rate), stored in Supabase, then pushed to
 *     the friend's open games (`dm`) and to my own other games. The answer is the stored row.
 *
 *   - `nudge` (protocol 3; `to`, `kind`): I changed something about a player (a friend request, an invite): their hub
 *     pushes `inbox` to their open games, which re-read their inbox from Supabase once.
 *
 * Pushes: `dm` (a message to or from me), `peer` (a friend came online, changed status, or went offline), `inbox`
 * (protocol 3: a request or an invite for me changed; re-read it).
 *
 * Dependency-free: no imports (the UI imports it).
 */

/**
 * VERSIONING: the hub is ONE Worker shared by every build, so old and new clients must coexist. `HUB_PROTOCOL` is what
 * this code speaks; a change that old clients can live with (a new optional field, a new push type) bumps it and they
 * keep working: both sides IGNORE unknown fields and unknown push types. A change old clients cannot survive raises
 * `HUB_PROTOCOL_MIN` (the hub then refuses those clients at hello with close 4409). Never rename or reuse a field.
 */
export const HUB_PROTOCOL = 3;
// 2 (2026-10-30, R-DM-REPLY-01): a `send` may carry `replyTo`, and a stored row may carry `replyTo` + `reply`. Optional
// both ways: a protocol 1 client never sends it and ignores it on the rows it gets; the minimum stays 1.
// 3 (2026-10-30, R-FRIENDS-HUB-LIVE-01): the `nudge` op and the `inbox` push (friend requests and invites arrive live,
// replacing the 60 s `friends_beat` poll and the Realtime invite subscription). A protocol 1-2 client never sends a
// nudge and ignores the push; an older hub answers a nudge `bad_op`, which the client ignores. The minimum stays 1.
/** The oldest client protocol the hub still accepts. */
export const HUB_PROTOCOL_MIN = 1;
/** The deployed hub (one stable Worker, never per content revision). */
export const FRIENDS_HUB_LIVE_URL = 'https://ascent-hub.team-ascent.workers.dev';
/** The hub's health route: `{ hub: HUB_PROTOCOL, min: HUB_PROTOCOL_MIN, code: <source hash> }`. */
export const HUB_HEALTH_PATH = '/health';
/** The hub's socket path. */
export const HUB_SOCKET_PATH = '/hub/ws';

/** The longest message, in characters (after trimming). */
export const DM_MAX_CHARS = 500;
/** Messages per account per window (every open game shares it). */
export const DM_RATE = { count: 5, windowMs: 10_000 } as const;
/** Open games (sockets) per account; a newer one closes the oldest. */
export const HUB_MAX_SOCKETS = 4;
/** How long the hub trusts its copy of my friends list before reading it again. */
export const HUB_FRIENDS_TTL_MS = 2 * 60_000;
/** How often a hub with open sockets looks for dead ones (a half-open phone socket never sends a close). */
export const HUB_SWEEP_MS = 60_000;
/** A socket with no keep-alive for this long is dead. */
export const HUB_STALE_MS = 45_000;

/** The hub mirrors a connected account's presence into Supabase (`hub_presence_cf`) this often while nothing changes, so
 *  the server-side "is this friend online" check (`friends__online`, 300 s window) and an older client's friends list
 *  keep reading it right. A change is mirrored at once (at most every `HUB_PRESENCE_MIN_GAP_MS`). */
export const HUB_PRESENCE_REFRESH_MS = 150_000;
export const HUB_PRESENCE_MIN_GAP_MS = 5_000;
/** Nudges per account per window (a nudge only makes the friend re-read their inbox, but it must never be a flood). */
export const HUB_NUDGE_RATE = { count: 10, windowMs: 10_000 } as const;

export type HubOp = 'hello' | 'presence' | 'send' | 'nudge';

/**
 * What a nudge says changed for its target (protocol 3). It carries no data: the target re-reads its inbox from Supabase
 * (the storage), once, so a forged nudge can only cause one extra read.
 *   - `friends`: a request was sent, accepted, declined, cancelled; a friend was removed, blocked or unblocked. Both hubs
 *     also re-read their friends (so a new friend sees me online at once).
 *   - `invite`: an invite (to a room, a party, or to spectate) was sent to them.
 */
export type HubNudgeKind = 'friends' | 'invite';
export const isNudgeKind = (k: unknown): k is HubNudgeKind => k === 'friends' || k === 'invite';

/**
 * A player's presence as friends see it: the Friends list's own shape (`PresenceReport` in the UI). Loose on purpose:
 * the hub only relays it (bounded in size), the UI parses it with the list's own parsers.
 */
export interface HubPresence {
  status: 'online' | 'in_game';
  mode?: string | null;
  watchKind?: string | null;
  watchId?: string | null;
  game?: unknown;
  activity?: unknown;
}
/** A presence larger than this (JSON characters) is dropped to its status alone. */
export const HUB_PRESENCE_MAX_CHARS = 2_000;

/** One friend's live state on the hub. `presence` null = offline. `at` = when it changed (epoch ms, hub clock). */
export interface HubPeer {
  userId: string;
  presence: HubPresence | null;
  at: number;
}

/** One stored direct message (the `direct_messages` row, as the client sees it). */
export interface DmRow {
  id: string;
  /** The sender's client id for this message (a retry of the same send is the same message). */
  cid: string | null;
  from: string;
  to: string;
  body: string;
  /** ISO time it was stored. */
  at: string;
  /** ISO time the recipient read it (null: unread). */
  readAt?: string | null;
  /** The message this one answers (same conversation), or null. Absent from protocol 1 hubs and old rows. */
  replyTo?: string | null;
  /** A short copy of the message it answers, for the quote above it (null when that message is gone). */
  reply?: DmReplyPreview | null;
}

/** The quote a reply shows: who wrote the original and the start of it (`DM_REPLY_SNIPPET` characters at most). */
export interface DmReplyPreview {
  id: string;
  from: string;
  body: string;
}
/** The longest quoted snippet a reply row carries, in characters. */
export const DM_REPLY_SNIPPET = 140;

export interface HubHello {
  protocol: number;
  presence: HubPresence | null;
  /** The client's build (content revision). Informational only: the hub never refuses on it. */
  build?: string;
}

export interface HubHelloAnswer {
  /** The protocol the hub speaks (absent on the first hub build: read as 1). */
  protocol?: number;
  me: string;
  peers: HubPeer[];
  now: string;
}

export interface HubSendArgs {
  /** A client-made uuid: the same send retried is stored once. */
  cid: string;
  to: string;
  body: string;
  /** Protocol 2: the stored message this one answers (a uuid in the same conversation; anything else is dropped). */
  replyTo?: string | null;
}

export type HubPush =
  | { t: 'dm'; msg: DmRow }
  | { t: 'peer'; peer: HubPeer }
  /** Protocol 3: my inbox changed (`kind`); re-read it. */
  | { t: 'inbox'; kind: HubNudgeKind };

/**
 * Errors a `send` can answer (the client maps each to a sentence): bad_body (empty or too long), rate_limited,
 * not_friends, blocked, unavailable (the store could not be reached: the client keeps the message queued and retries).
 */
export type DmSendError = 'bad_body' | 'bad_target' | 'rate_limited' | 'not_friends' | 'blocked' | 'unavailable';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

/** Control, zero-width, bidi-override and BOM characters (built from code points: the source stays plain ASCII). */
const cp = (n: number): string => String.fromCharCode(n);
const INVISIBLE = new RegExp(`[${cp(0)}-${cp(0x1f)}${cp(0x7f)}-${cp(0x9f)}${cp(0x200b)}-${cp(0x200f)}${cp(0x2028)}-${cp(0x202e)}${cp(0x2060)}-${cp(0x206f)}${cp(0xfeff)}]`, 'g');

/**
 * A message body as it is stored: control characters removed (a newline becomes a space), runs of spaces collapsed,
 * trimmed. Null when nothing is left or it is longer than `DM_MAX_CHARS`. Pure; the client runs it too, so what is
 * shown while sending is what is stored.
 */
export function cleanDmBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return [...s].length > DM_MAX_CHARS ? null : s;
}

/** A reply preview from a store row, or null when it is not one. Pure. */
export function cleanReplyPreview(raw: unknown): DmReplyPreview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.from !== 'string' || typeof r.body !== 'string') return null;
  return { id: r.id, from: r.from.toLowerCase(), body: [...r.body].slice(0, DM_REPLY_SNIPPET).join('') };
}

/** A presence as the hub keeps it: known fields only, and bounded. Null for anything that is not a presence. */
export function cleanPresence(raw: unknown): HubPresence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.status !== 'online' && r.status !== 'in_game') return null;
  const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
  const p: HubPresence = { status: r.status, mode: str(r.mode, 24), watchKind: str(r.watchKind, 16), watchId: str(r.watchId, 64) };
  if (r.game && typeof r.game === 'object') p.game = r.game;
  if (r.activity && typeof r.activity === 'object') p.activity = r.activity;
  try {
    if (JSON.stringify(p).length > HUB_PRESENCE_MAX_CHARS) return { status: p.status, mode: p.mode, watchKind: null, watchId: null };
  } catch {
    return { status: p.status };
  }
  return p;
}
