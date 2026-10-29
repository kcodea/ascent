/**
 * FRIENDS — the Supabase adapter (owner 2026-10-26; R-FRIENDS-01..05). No React, no store: each call returns plain data
 * or throws a `FriendsError` carrying the SQL's code (`raise exception '<code>'`). Every RPC lives in
 * supabase/migrations/2026-10-28-friends.sql.
 *
 * EGRESS (R-FRIENDS-05): the only periodic call is `beat` (presence + inbox in one, ~100 bytes of body when nothing is
 * waiting); the friends list is `list` (one batched read, only while a friends surface is open); the one Realtime
 * subscription is INSERTs on `friend_invites` filtered to rows addressed to me. Presence is never broadcast.
 */
import { parseActivity, parseGameStatus, type FriendActivity, type FriendGameStatus } from './gameStatus';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { keepaliveRpc, supabaseClient } from '../remoteBoards';

export type PresenceStatus = 'online' | 'in_game' | 'offline';
export type WatchKind = 'live' | 'versus';
/** 'versus_room' and 'duos_party' bring a friend INTO my room; 'spectate' (owner 2026-10-29, R-FRIENDS-MENU-02) asks them
 *  to WATCH my game: its target is `live:<game id>` (a lobby / Practice game), `versus:<room ref>` or `duos:<room ref>`. */
export type InviteKind = 'versus_room' | 'duos_party' | 'spectate';
/** An invite kind from a server row (an unknown kind reads as a room invite, as before). */
export const inviteKindOf = (k: unknown): InviteKind => (k === 'duos_party' || k === 'spectate' ? k : 'versus_room');

/** A player's public card (the friends__card SQL). */
export interface FriendCard {
  userId: string;
  author: string | null;
  discriminator: string | null;
  avatar: string | null;
  favoriteHero: string | null;
  /** The equipped portrait frame cosmetic id. */
  frame: string | null;
  /** The equipped skin of their favourite hero. */
  skin: string | null;
  since?: string | null;
}

export interface Friend extends FriendCard {
  status: PresenceStatus;
  mode?: string | null;
  watchKind?: WatchKind | null;
  watchId?: string | null;
  lastSeen: string | null;
  /** In a game: what it looks like right now (R-FRIENDS-STATUS-01; absent on a server without the 2026-11-08 SQL). */
  game?: FriendGameStatus | null;
  /** Online, not in a game: where they are (R-FRIENDS-ACTIVITY-01; absent when they hide it or on an older server). */
  activity?: FriendActivity | null;
}

export interface FriendInvite {
  id: string;
  kind: InviteKind;
  target: string;
  expiresAt: string;
  createdAt?: string;
  from: FriendCard;
}

export interface SentInvite {
  id: string;
  to: string;
  kind: InviteKind;
  target: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  expiresAt: string;
}

export interface FriendsList {
  friends: Friend[];
  incoming: FriendCard[];
  outgoing: FriendCard[];
  blocked: FriendCard[];
  invites: FriendInvite[];
  sent: SentInvite[];
  serverNow: string;
}

export interface BeatAnswer {
  friends: number;
  online: number;
  incoming: number;
  invites: FriendInvite[];
  serverNow: string;
}

export interface PresenceReport {
  status: PresenceStatus;
  mode: string | null;
  watchKind: WatchKind | null;
  watchId: string | null;
  /** In a game: its at-a-glance status (R-FRIENDS-STATUS-01). Omitted / null otherwise. */
  game?: FriendGameStatus | null;
  /** Online, not in a game: where I am (R-FRIENDS-ACTIVITY-01). Rides the same `p_game` slot, told apart by `act`. */
  activity?: FriendActivity | null;
}

export class FriendsError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

const KNOWN = /^[a-z_]+$/;
function fail(e: { message?: string; code?: string } | null | undefined): never {
  const msg = (e?.message ?? 'unknown').trim();
  // The friends SQL is not on this server yet (PostgREST: unknown function / relation).
  if (e?.code === 'PGRST202' || e?.code === 'PGRST205' || e?.code === '42P01' || e?.code === '42883') throw new FriendsError('not_deployed', msg);
  throw new FriendsError(KNOWN.test(msg) ? msg : 'network', msg);
}

/** Every SQL code a player can meet, as one plain sentence (no em dashes, owner writing rule). */
export const FRIENDS_ERROR_TEXT: Record<string, string> = {
  not_signed_in: 'Sign in to use friends.',
  guest: 'Save your account to add friends.',
  bad_handle: 'Type a name and tag, like Name#1234.',
  not_found: 'No player has that name and tag.',
  not_an_account: 'That player has not saved their account yet.',
  self: 'That is you.',
  blocked: 'You cannot add this player.',
  you_blocked: 'You blocked this player. Unblock them first.',
  already_friends: 'You are already friends.',
  already_requested: 'Request already sent.',
  too_many_friends: 'Your friends list is full.',
  too_many_requests: 'You have too many requests waiting. Cancel some first.',
  rate_limited: 'Slow down a little. Try again later.',
  no_request: 'That request is no longer there.',
  not_friends: 'You are not friends with this player.',
  not_online: 'That friend is not online right now.',
  not_in_room: 'You are not in that room.',
  room_not_open: 'That room is not open.',
  already_in_room: 'They are already in the room.',
  room_check: 'Could not check the room. Try again.',
  no_game: 'Your game is not running.',
  invites_unavailable: 'Invites are not available for this room yet.',
  no_invite: 'That invite is no longer there.',
  expired: 'That invite has expired.',
  not_deployed: 'Friends are not available yet.',
  no_backend: 'Friends are not available offline.',
  network: 'Could not reach the server. Try again.',
};
export const friendsErrorText = (e: unknown): string =>
  FRIENDS_ERROR_TEXT[(e as FriendsError)?.code ?? 'network'] ?? FRIENDS_ERROR_TEXT.network!;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
function cardOf(r: Record<string, unknown>): FriendCard {
  return {
    userId: String(r.userId ?? ''), author: str(r.author), discriminator: str(r.discriminator), avatar: str(r.avatar),
    favoriteHero: str(r.favoriteHero), frame: str(r.frame), skin: str(r.skin), since: str(r.since),
  };
}
function friendOf(r: Record<string, unknown>): Friend {
  const status = r.status === 'online' || r.status === 'in_game' ? r.status : 'offline';
  return {
    ...cardOf(r), status, mode: str(r.mode),
    watchKind: r.watchKind === 'live' || r.watchKind === 'versus' ? r.watchKind : null,
    watchId: str(r.watchId), lastSeen: str(r.lastSeen),
    game: status === 'in_game' ? parseGameStatus(r.game) : null,
    activity: status === 'online' ? parseActivity(r.game) : null,
  };
}
function inviteOf(r: Record<string, unknown>): FriendInvite {
  return {
    id: String(r.id), kind: inviteKindOf(r.kind), target: String(r.target ?? ''),
    expiresAt: String(r.expiresAt ?? ''), createdAt: str(r.createdAt) ?? undefined, from: cardOf((r.from ?? {}) as Record<string, unknown>),
  };
}
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function parseFriendsList(raw: unknown): FriendsList {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    friends: arr(r.friends).map(friendOf),
    incoming: arr(r.incoming).map(cardOf),
    outgoing: arr(r.outgoing).map(cardOf),
    blocked: arr(r.blocked).map(cardOf),
    invites: arr(r.invites).map(inviteOf),
    sent: arr(r.sent).map((s) => ({
      id: String(s.id), to: String(s.to), kind: inviteKindOf(s.kind), target: String(s.target ?? ''),
      status: (['pending', 'accepted', 'declined', 'cancelled', 'expired'].includes(String(s.status)) ? s.status : 'expired') as SentInvite['status'],
      expiresAt: String(s.expiresAt ?? ''),
    })),
    serverNow: String(r.serverNow ?? ''),
  };
}

export function parseBeat(raw: unknown): BeatAnswer {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    friends: Number(r.friends) || 0, online: Number(r.online) || 0, incoming: Number(r.incoming) || 0,
    invites: arr(r.invites).map(inviteOf), serverNow: String(r.serverNow ?? ''),
  };
}

export function makeFriendsRemote(getClient: () => SupabaseClient | null) {
  let gameRefused = false;
  // The player's access token, kept current by the auth client's own events, so the `pagehide` "I left" beat can be
  // signed synchronously (a page being closed cannot await `getSession`). Subscribed once, on the first beat.
  let token: string | null = null;
  let watchingToken = false;
  const watchToken = (c: SupabaseClient): void => {
    if (watchingToken) return;
    watchingToken = true;
    try { c.auth.onAuthStateChange((_e, s) => { token = s?.access_token ?? null; }); } catch { /* a stand-in client */ }
  };
  const db = (): SupabaseClient => {
    const c = getClient();
    if (!c) throw new FriendsError('no_backend');
    return c;
  };
  async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    // rows: every friends RPC returns ONE jsonb value (the list is capped by 200 friends / 50 requests in SQL), never a table (R-NET-01).
    const { data, error } = await db().rpc(fn, args);
    if (error) fail(error);
    return data as T;
  }
  return {
    async beat(p: PresenceReport): Promise<BeatAnswer> {
      watchToken(db());
      const base = { p_status: p.status, p_mode: p.mode, p_watch_kind: p.watchKind, p_watch_id: p.watchId };
      // `p_game` only when there is one, and never again once a server without the 2026-11-08 SQL refused it: that
      // server still takes the four-argument beat (a refused status must never stop presence).
      // The activity (online) rides the same slot as the game status (in a game); a server without
      // 2026-11-10-friends-activity.sql stores only an in-game status and drops the rest, never an error.
      const detail = p.game ?? p.activity ?? null;
      if (detail && !gameRefused) {
        try {
          return parseBeat(await rpc('friends_beat', { ...base, p_game: detail }));
        } catch (e) {
          if ((e as FriendsError).code !== 'not_deployed') throw e;
          gameRefused = true;
        }
      }
      return parseBeat(await rpc('friends_beat', base));
    },
    /** "I left": an Offline beat that survives the page closing (keepalive). False when it could not be sent. */
    leave: (): boolean => !!token && keepaliveRpc('friends_beat', { p_status: 'offline' }, token),
    list: async (): Promise<FriendsList> => parseFriendsList(await rpc('friends_list')),
    requestByHandle: (handle: string) => rpc<{ status: 'sent' | 'accepted'; userId: string }>('friends_request', { p_user: null, p_handle: handle }),
    requestById: (userId: string) => rpc<{ status: 'sent' | 'accepted'; userId: string }>('friends_request', { p_user: userId, p_handle: null }),
    respond: (userId: string, accept: boolean) => rpc('friends_respond', { p_user: userId, p_accept: accept }),
    cancel: (userId: string) => rpc('friends_cancel', { p_user: userId }),
    remove: (userId: string) => rpc('friends_remove', { p_user: userId }),
    block: (userId: string) => rpc('friends_block', { p_user: userId }),
    unblock: (userId: string) => rpc('friends_unblock', { p_user: userId }),
    /** `proof`: a Cloudflare room's signed check (R-VERSUS-CF-INVITE-01); omitted for a Supabase room, so the call is
     *  exactly the three-argument one every server understands. */
    invite: (userId: string, kind: InviteKind, target: string, proof?: string | null) =>
      rpc<{ id: string; kind: InviteKind; target: string; expiresAt: string }>('friends_invite',
        proof ? { p_user: userId, p_kind: kind, p_target: target, p_proof: proof } : { p_user: userId, p_kind: kind, p_target: target }),
    respondInvite: (id: string, accept: boolean) =>
      rpc<{ status: 'accepted' | 'declined'; kind: InviteKind; target: string; from: string }>('friends_invite_respond', { p_invite: id, p_accept: accept }),
    cancelInvite: (id: string) => rpc('friends_invite_cancel', { p_invite: id }),
    /** A wake-up when an invite addressed to ME is inserted (RLS + the to_user filter: nobody else's rows). */
    subscribeInvites(me: string, onInvite: () => void): { channel: RealtimeChannel; close: () => void } {
      const c = db();
      const ch = c.channel(`friends:${me}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_invites', filter: `to_user=eq.${me}` }, () => onInvite());
      ch.subscribe();
      return { channel: ch, close: () => { void c.removeChannel(ch); } };
    },
  };
}

export type FriendsRemote = ReturnType<typeof makeFriendsRemote>;
export const friendsRemote: FriendsRemote = makeFriendsRemote(supabaseClient);
