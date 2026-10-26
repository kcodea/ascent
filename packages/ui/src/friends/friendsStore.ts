/**
 * FRIENDS — the client state (owner 2026-10-26; R-FRIENDS-01..05). Three pieces, all egress-safe (R-FRIENDS-05):
 *
 *  1. THE PRESENCE BEAT (`startFriendsPresence`, once at boot): ONE call, `friends_beat`, writes my presence (online on a
 *     menu, in a game with its mode and a watch target) and answers my inbox (friends, friends online, requests waiting,
 *     open invites). Every 60 s while the tab is visible, every 120 s while hidden, at once (at most every 5 s) when my
 *     status changes, and every 180 s for an account with no friends yet. Failures back off (doubling, up to 10 min);
 *     an undeployed server stops it for the session. Guests and offline builds never beat.
 *  2. THE INVITE WAKE-UP: a Realtime subscription to INSERTs on `friend_invites` addressed to me (to_user filter + RLS),
 *     only for an account with at least one friend and only while the tab is visible. Each insert triggers one beat.
 *  3. THE FRIENDS LIST (`useFriendsListLoop`): the one batched `friends_list` read, only while a friends surface is open
 *     (the Friends page, the room's invite panel), every 60 s while visible, nothing while hidden, backing off on errors.
 *
 * Nothing here is broadcast: presence is read by friends through the list, never pushed (R-NET-REALTIME-01).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { lobbyIsUnrated, normalizeVersusOptions, rankedRunIdOf } from '@game/sim';
import { remoteEnabled } from '../remoteBoards';
import { pageHidden } from '../net/backoff';
import { useGame } from '../store';
import { useVersus, myRole } from '../versus/versusStore';
import { isWatchingLive } from '../live/liveWatch';
import { liveEligible } from '../live/livePublisher';
import {
  friendsRemote, friendsErrorText, FriendsError, type BeatAnswer, type FriendInvite, type FriendsList, type FriendsRemote,
  type InviteKind, type PresenceReport,
} from './friendsRemote';

export const BEAT_VISIBLE_MS = 60_000;
export const BEAT_HIDDEN_MS = 120_000;
export const BEAT_FRIENDLESS_MS = 180_000;
export const BEAT_MIN_GAP_MS = 5_000;
export const BEAT_MAX_BACKOFF_MS = 600_000;
export const LIST_MS = 60_000;
export const LIST_MAX_BACKOFF_MS = 300_000;

export interface FriendsState {
  /** The last beat's answer (null until the first one). */
  inbox: BeatAnswer | null;
  /** The last friends_list answer (null until a friends surface opened once). */
  list: FriendsList | null;
  listFailed: boolean;
  /** False once the server said the friends SQL is not there (stops every call this session). */
  deployed: boolean;
  /** Ids of players with an action in flight (a button shows its pending state). */
  busy: Record<string, true>;
  /** A short message for the friends surfaces (an error, or "Request sent"). */
  flash: string | null;
  /** Invites this client has answered or dismissed (hidden at once, before the server's next answer). */
  answered: Record<string, true>;
  /** The server clock's lead over mine, measured when the last answer landed (an expiry reads right on a skewed clock). */
  skew: number;
}

export const useFriends = create<FriendsState>(() => ({
  inbox: null, list: null, listFailed: false, deployed: true, busy: {}, flash: null, answered: {}, skew: 0,
}));

/** The server clock's lead over mine at the moment `serverNow` was received. */
const skewOf = (serverNow: string | null | undefined): number => {
  const t = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(t) ? t - Date.now() : 0;
};
const get = useFriends.getState;
const set = useFriends.setState;

let remote: FriendsRemote = friendsRemote;
/** Tests: a fake network. */
export function setFriendsRemoteForTests(r: FriendsRemote): void { remote = r; }

/** A signed-in account (not a guest) on a configured backend: the only player who has friends. */
export function friendsAccount(): boolean {
  const a = useGame.getState().account;
  return remoteEnabled() && !!a.userId && !a.anonymous;
}

// ── what I am doing right now ────────────────────────────────────────────────────────────────────────────

/** The presence modes (the panel's words live in `presenceText`). */
export type PresenceMode = 'ranked' | 'casual' | 'practice' | 'tutorial' | 'gauntlet' | 'solo' | 'versus_room' | 'versus_1v1'
  | 'versus_group' | 'versus_duos' | 'ranked_duos' | 'watching' | 'replay';

const VERSUS_MODE_OF = { duel: 'versus_1v1', group: 'versus_group', duos: 'versus_duos' } as const;

/** My presence, from the stores. Cheap (a few field reads); pure for the tests. */
export function presenceNow(): PresenceReport {
  const g = useGame.getState();
  const v = useVersus.getState();
  if (v.room) {
    const mode = VERSUS_MODE_OF[normalizeVersusOptions(v.room.options).mode];
    const role = myRole(v.room);
    const running = v.room.status === 'in_game' && !!v.match && v.match.phase !== 'complete';
    if (running && role && role !== 'spectator') return { status: 'in_game', mode, watchKind: 'versus', watchId: v.room.id };
    if (running) return { status: 'online', mode: 'watching', watchKind: null, watchId: null };
    return { status: 'online', mode: 'versus_room', watchKind: null, watchId: null };
  }
  if (isWatchingLive()) return { status: 'online', mode: 'watching', watchKind: null, watchId: null };
  if (g.replaying) return { status: 'online', mode: 'replay', watchKind: null, watchId: null };
  const run = g.run;
  const playing = !g.showTitle && !g.practiceSetupOpen && !g.heroChoices && (run.phase === 'recruit' || run.phase === 'combat');
  if (!playing) return { status: 'online', mode: null, watchKind: null, watchId: null };
  let mode: PresenceMode = 'solo';
  if (run.mode === 'lobby') mode = run.sandbox || run.godMode ? 'practice' : run.lobby && lobbyIsUnrated(run.lobby) ? 'casual' : 'ranked';
  else if (run.mode === 'practice' || run.mode === 'tutorial' || run.mode === 'gauntlet') mode = run.mode;
  // A ranked game is watchable through Live Games (the same gate the listing uses).
  const live = mode === 'ranked' && liveEligible(run, { replaying: g.replaying, showTitle: g.showTitle });
  return { status: 'in_game', mode, watchKind: live ? 'live' : null, watchId: live ? rankedRunIdOf(run) : null };
}

const presenceKey = (p: PresenceReport): string => `${p.status}|${p.mode ?? ''}|${p.watchKind ?? ''}|${p.watchId ?? ''}`;

/** "Ranked", "Versus Duos", ... for a presence mode. */
export function modeText(mode: string | null | undefined): string | null {
  switch (mode) {
    case 'ranked': return 'Ranked';
    case 'casual': return 'Casual';
    case 'practice': return 'Practice';
    case 'tutorial': return 'Tutorial';
    case 'gauntlet': return 'Gauntlet';
    case 'versus_room': return 'Versus room';
    case 'versus_1v1': return 'Versus 1v1';
    case 'versus_group': return 'Versus Group';
    case 'versus_duos': return 'Versus Duos';
    case 'ranked_duos': return 'Ranked Duos';
    case 'watching': return 'Watching a game';
    case 'replay': return 'Watching a replay';
    default: return null;
  }
}

/** "3 minutes ago" for an Offline friend's last seen. Coarse on purpose. */
export function lastSeenText(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'Offline';
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 2) return 'Last seen just now';
  if (min < 60) return `Last seen ${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Last seen ${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.round(h / 24);
  return `Last seen ${d} ${d === 1 ? 'day' : 'days'} ago`;
}

// ── the beat ─────────────────────────────────────────────────────────────────────────────────────────────

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastAt = -Infinity;
let lastKey = '';
let failures = 0;
let inFlight = false;
let invitesSub: { close: () => void } | null = null;
let invitesSubFor = '';

function clearTimer(): void { if (timer !== null) { clearTimeout(timer); timer = null; } }

function nextDelay(): number {
  const ib = get().inbox;
  let d = pageHidden() ? BEAT_HIDDEN_MS : BEAT_VISIBLE_MS;
  // An account with no friends and nothing waiting only needs to hear about new requests now and then.
  if (ib && ib.friends === 0 && ib.incoming === 0 && !pageHidden()) d = BEAT_FRIENDLESS_MS;
  if (failures > 0) d = Math.min(BEAT_MAX_BACKOFF_MS, d * 2 ** failures);
  return d;
}

function schedule(ms: number): void {
  clearTimer();
  timer = setTimeout(() => { timer = null; void beatNow(); }, Math.max(0, ms));
}

/** Beat now (or as soon as the minimum gap allows). Resolves when the answer has landed. */
export async function beatNow(): Promise<void> {
  if (!get().deployed || !friendsAccount()) { syncInviteSub(); return; }
  if (inFlight) return;
  const now = Date.now();
  if (now - lastAt < BEAT_MIN_GAP_MS) { schedule(lastAt + BEAT_MIN_GAP_MS - now); return; }
  const p = presenceNow();
  inFlight = true;
  lastAt = now;
  lastKey = presenceKey(p);
  try {
    const answer = await remote.beat(p);
    failures = 0;
    set({ inbox: answer, skew: skewOf(answer.serverNow) });
  } catch (e) {
    if ((e as FriendsError)?.code === 'not_deployed' || (e as FriendsError)?.code === 'guest') {
      if ((e as FriendsError).code === 'not_deployed') set({ deployed: false });
      inFlight = false;
      clearTimer();
      syncInviteSub();
      return;
    }
    failures++;
  }
  inFlight = false;
  syncInviteSub();
  if (started) schedule(nextDelay());
}

/** My status may have changed: beat soon if it did. */
function onMaybeChanged(): void {
  if (!started || !friendsAccount()) { syncInviteSub(); return; }
  if (presenceKey(presenceNow()) === lastKey) return;
  const wait = Math.max(0, lastAt + BEAT_MIN_GAP_MS - Date.now());
  schedule(Math.max(wait, 800)); // a short settle: a screen change often lands in two writes
}

/** The invite wake-up: on while an account with friends has the tab visible. */
function syncInviteSub(): void {
  const me = useGame.getState().account.userId;
  const want = started && get().deployed && friendsAccount() && !pageHidden() && (get().inbox?.friends ?? 0) > 0 && !!me;
  const key = want ? me! : '';
  if (key === invitesSubFor) return;
  invitesSub?.close();
  invitesSub = null;
  invitesSubFor = key;
  if (!want) return;
  try {
    invitesSub = remote.subscribeInvites(me!, () => { lastAt = -Infinity; void beatNow(); });
  } catch { invitesSub = null; }
}

/** Start the presence beat (once, at boot). Returns a stop function (tests). */
export function startFriendsPresence(): () => void {
  if (started || typeof window === 'undefined') return () => undefined;
  started = true;
  const unGame = useGame.subscribe((s, prev) => {
    if (s.account.userId !== prev.account.userId || s.account.anonymous !== prev.account.anonymous) {
      // A new identity (sign in, sign out, a guest saved): start over at once.
      lastAt = -Infinity; lastKey = ''; failures = 0;
      set({ inbox: null, list: null });
      if (friendsAccount()) schedule(0); else { clearTimer(); syncInviteSub(); }
      return;
    }
    if (s.showTitle !== prev.showTitle || s.practiceSetupOpen !== prev.practiceSetupOpen || s.replaying !== prev.replaying
      || s.heroChoices !== prev.heroChoices || s.run.mode !== prev.run.mode || s.run.phase !== prev.run.phase) onMaybeChanged();
  });
  const unVs = useVersus.subscribe((s, prev) => {
    if (s.room?.id !== prev.room?.id || s.room?.status !== prev.room?.status || s.match?.phase !== prev.match?.phase) onMaybeChanged();
  });
  const onVis = (): void => {
    syncInviteSub();
    if (!pageHidden() && Date.now() - lastAt >= nextDelay()) schedule(0);
  };
  document.addEventListener('visibilitychange', onVis);
  schedule(1500); // after boot settles (the session lands first)
  return () => {
    started = false;
    clearTimer();
    unGame(); unVs();
    document.removeEventListener('visibilitychange', onVis);
    invitesSub?.close(); invitesSub = null; invitesSubFor = '';
  };
}

/** Tests: forget the loop's memory. */
export function resetFriendsForTests(): void {
  clearTimer();
  started = false; lastAt = -Infinity; lastKey = ''; failures = 0; inFlight = false;
  invitesSub?.close(); invitesSub = null; invitesSubFor = '';
  remote = friendsRemote;
  set({ inbox: null, list: null, listFailed: false, deployed: true, busy: {}, flash: null, answered: {}, skew: 0 });
}

// ── the friends list (only while a friends surface is open) ──────────────────────────────────────────────

let listUsers = 0;
let listTimer: ReturnType<typeof setTimeout> | null = null;
let listFails = 0;
let listNextAt = 0;
let listInFlight = false;

/** Read the list now. */
export async function refreshFriendsList(): Promise<void> {
  if (!get().deployed || !friendsAccount() || listInFlight) return;
  listInFlight = true;
  try {
    const list = await remote.list();
    listFails = 0;
    // The list carries the same invites as the beat: keep the inbox in step without another call.
    const ib = get().inbox;
    set({
      list, listFailed: false,
      inbox: {
        friends: list.friends.length, online: list.friends.filter((f) => f.status !== 'offline').length,
        incoming: list.incoming.length, invites: list.invites, serverNow: list.serverNow ?? ib?.serverNow ?? '',
      },
      skew: skewOf(list.serverNow),
    });
  } catch (e) {
    if ((e as FriendsError)?.code === 'not_deployed') set({ deployed: false });
    listFails++;
    set({ listFailed: true });
  }
  listInFlight = false;
  listNextAt = Date.now() + Math.min(LIST_MAX_BACKOFF_MS, LIST_MS * 2 ** listFails);
}

function listTick(): void {
  listTimer = null;
  if (listUsers <= 0) return;
  if (!pageHidden() && Date.now() >= listNextAt) void refreshFriendsList().then(armList);
  else armList();
}
function armList(): void {
  if (listUsers <= 0 || listTimer !== null) return;
  listTimer = setTimeout(listTick, Math.max(1000, Math.min(LIST_MS, listNextAt - Date.now())));
}

/** Keep the friends list fresh while `active` (shared by every open friends surface). */
export function useFriendsListLoop(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    listUsers++;
    if (listUsers === 1) { listNextAt = 0; void refreshFriendsList().then(armList); }
    const onVis = (): void => { if (!pageHidden() && Date.now() >= listNextAt) void refreshFriendsList(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      listUsers--;
      if (listUsers <= 0 && listTimer !== null) { clearTimeout(listTimer); listTimer = null; }
    };
  }, [active]);
}

// ── actions ──────────────────────────────────────────────────────────────────────────────────────────────

let flashTimer: ReturnType<typeof setTimeout> | null = null;
export function flashFriends(msg: string | null): void {
  set({ flash: msg });
  if (flashTimer) clearTimeout(flashTimer);
  if (msg) flashTimer = setTimeout(() => { if (get().flash === msg) set({ flash: null }); }, 3500);
}

async function act<T>(id: string, run: () => Promise<T>, ok?: string): Promise<T | null> {
  if (get().busy[id]) return null;
  set({ busy: { ...get().busy, [id]: true } });
  try {
    const r = await run();
    if (ok) flashFriends(ok);
    return r;
  } catch (e) {
    flashFriends(friendsErrorText(e));
    return null;
  } finally {
    const b = { ...get().busy };
    delete b[id];
    set({ busy: b });
    void refreshFriendsList();
  }
}

/** Send a request by handle ("Name#1234"). Resolves true when it went through. */
export async function addFriendByHandle(handle: string): Promise<boolean> {
  const h = handle.trim();
  if (!/^.{1,40}#[0-9]{4}$/.test(h)) { flashFriends(friendsErrorText(new FriendsError('bad_handle'))); return false; }
  const r = await act(`handle:${h}`, () => remote.requestByHandle(h));
  if (r) flashFriends(r.status === 'accepted' ? 'You are now friends.' : 'Friend request sent.');
  return !!r;
}
export async function addFriend(userId: string): Promise<boolean> {
  const r = await act(userId, () => remote.requestById(userId));
  if (r) flashFriends(r.status === 'accepted' ? 'You are now friends.' : 'Friend request sent.');
  return !!r;
}
export const acceptRequest = (userId: string): Promise<unknown> => act(userId, () => remote.respond(userId, true), 'You are now friends.');
export const declineRequest = (userId: string): Promise<unknown> => act(userId, () => remote.respond(userId, false));
export const cancelRequest = (userId: string): Promise<unknown> => act(userId, () => remote.cancel(userId));
export const removeFriend = (userId: string): Promise<unknown> => act(userId, () => remote.remove(userId), 'Friend removed.');
export const blockPlayer = (userId: string): Promise<unknown> => act(userId, () => remote.block(userId), 'Player blocked.');
export const unblockPlayer = (userId: string): Promise<unknown> => act(userId, () => remote.unblock(userId), 'Player unblocked.');

/**
 * THE INVITE API (Versus rooms now; the Ranked Duos party uses the same call with kind 'duos_party' and its party id).
 * The server checks the friendship, that the friend is online, and the target (a Versus room: one I am in and open).
 */
export async function inviteFriend(userId: string, kind: InviteKind, target: string): Promise<boolean> {
  const r = await act(`invite:${userId}`, () => remote.invite(userId, kind, target), 'Invite sent.');
  return !!r;
}

/** What the relationship with a player is, from the last list (the Add friend buttons read it). */
export type Relation = 'self' | 'friend' | 'outgoing' | 'incoming' | 'blocked' | 'none';
export function relationOf(userId: string, st: Pick<FriendsState, 'list'> = get()): Relation {
  if (userId === useGame.getState().account.userId) return 'self';
  const l = st.list;
  if (!l) return 'none';
  if (l.friends.some((f) => f.userId === userId)) return 'friend';
  if (l.outgoing.some((f) => f.userId === userId)) return 'outgoing';
  if (l.incoming.some((f) => f.userId === userId)) return 'incoming';
  if (l.blocked.some((f) => f.userId === userId)) return 'blocked';
  return 'none';
}

// ── invites addressed to me ──────────────────────────────────────────────────────────────────────────────

/** How an accepted invite of a kind is carried out. 'versus_room' is built in (invites.ts); the Ranked Duos party
 *  registers 'duos_party'. An invite whose kind has no handler is never shown. */
export type InviteHandler = (invite: FriendInvite) => Promise<void> | void;
const handlers = new Map<InviteKind, InviteHandler>();
export function registerInviteHandler(kind: InviteKind, h: InviteHandler): () => void {
  handlers.set(kind, h);
  return () => { if (handlers.get(kind) === h) handlers.delete(kind); };
}
export const inviteHandlerOf = (kind: InviteKind): InviteHandler | undefined => handlers.get(kind);

/** Open invites I can act on: not expired (on the server's clock), not answered here, of a kind with a handler. Newest
 *  first (the server's order). */
export function openInvites(st: Pick<FriendsState, 'inbox' | 'answered'> = get(), now = Date.now(), skew = get().skew): FriendInvite[] {
  return (st.inbox?.invites ?? []).filter((i) => !st.answered[i.id] && handlers.has(i.kind) && Date.parse(i.expiresAt) > now + skew);
}

export async function answerInvite(invite: FriendInvite, accept: boolean): Promise<void> {
  set({ answered: { ...get().answered, [invite.id]: true } });
  try {
    const r = await remote.respondInvite(invite.id, accept);
    if (accept && r.status === 'accepted') await handlers.get(invite.kind)?.(invite);
  } catch (e) {
    if (accept) flashFriends(friendsErrorText(e));
  }
}

/** Just hide it (the notice's timer ran out or it was dismissed without an answer). */
export function dropInvite(id: string): void {
  set({ answered: { ...get().answered, [id]: true } });
}
