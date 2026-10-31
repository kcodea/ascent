/**
 * FRIENDS — the client state (owner 2026-10-26; R-FRIENDS-01..05). Since R-FRIENDS-HUB-LIVE-01 (owner 2026-10-30: "I want
 * us to make cloudflare work as our source for live information and action like spectating") every LIVE part runs on
 * the friends hub (`workers/versus/src/hub.ts`, the socket `dm/dmStore.ts` holds); Supabase keeps the storage
 * (friendships, requests, blocks, invites), read only when something changed:
 *
 *  1. MY PRESENCE (`startFriendsPresence`, once at boot): what I am doing, sent to the hub when it SETTLES
 *     (`CHANGE_SETTLE_MS`, at most every `PRESENCE_MIN_GAP_MS`, only when the COARSE activity moved; R-FRIENDS-ACTIVITY-01).
 *     "Show friends what I'm doing" off (`friendsPrefs.ts`) sends only Online, or In a game with its mode. The hub tells
 *     my connected friends at once, and mirrors it into Supabase itself (for the server-side invite check and older
 *     clients). There is NO periodic call: the old 60 s `friends_beat` is gone, and so is the Offline beat on close (the
 *     hub sees my last socket close).
 *  2. MY INBOX (friends, requests waiting, open invites): one `friends_list` read when I sign in or the hub socket (re)
 *     opens, then only when the hub pushes `inbox` (a friend request, an accept, an invite for me: the sender's client
 *     nudges my hub). Reads are coalesced (`INBOX_MIN_GAP_MS`). This replaced the Realtime subscription on
 *     `friend_invites`. My own actions nudge the other player the same way (`setHubNotifier`).
 *  3. THE FRIENDS LIST (`useFriendsListLoop`): the same `friends_list` read while a friends surface is open (the Friends
 *     dock, the room's invite panel), every 60 s while visible, nothing while hidden, backing off on errors. Friends'
 *     live presence is laid over it from the hub (`liveFriends`).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { lobbyIsUnrated, normalizeVersusOptions, rankedRunIdOf, VERSUS_MODE_SEATS, type RunLobby } from '@game/sim';
import { remoteEnabled } from '../remoteBoards';
import { pageHidden } from '../net/backoff';
import { useGame } from '../store';
import { useVersus, myRole } from '../versus/versusStore';
import { versusRemote, versusRoomRef } from '../versus/versusRemote';
import {
  activityKey, gameCoarseKey, lobbyFoeName, lobbyStatusNow, NAME_MAX, resetFoeCacheForTests, versusGameStatus, versusLine, type ActivityKind, type FriendActivity, type GameExtras,
} from './gameStatus';
import { useFriendsPrefs } from './friendsPrefs';
import { decodeRoomRef } from '../versus/versusHost';
import { isWatchingLive, useLiveWatch } from '../live/liveWatch';
import { liveEligible } from '../live/livePublisher';
import {
  friendsRemote, friendsErrorText, FriendsError, type BeatAnswer, type FriendInvite, type FriendsList, type FriendsRemote,
  type InviteKind, type PresenceReport,
} from './friendsRemote';

/** My presence is sent to the hub at most this often (a change inside the gap waits for it). */
export const PRESENCE_MIN_GAP_MS = 5_000;
/** A change waits this long for the screen to settle before it is sent (R-FRIENDS-ACTIVITY-01). */
export const CHANGE_SETTLE_MS = 1_500;
/** Two inbox reads are at least this far apart (a burst of nudges is one read). */
export const INBOX_MIN_GAP_MS = 3_000;
export const LIST_MS = 60_000;
export const LIST_MAX_BACKOFF_MS = 300_000;

export interface FriendsState {
  /** My inbox (friends, requests waiting, open invites), from the last `friends_list` read (null until the first). */
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

const VERSUS_MODE_OF = { duel: 'versus_1v1', group: 'versus_group', duos: 'versus_duos', ranked_duos: 'ranked_duos' } as const;

/**
 * My presence, from the stores. Cheap (a few field reads; one pairing only during a fight); pure for the tests.
 * "Show friends what I'm doing" off (R-FRIENDS-ACTIVITY-01): only Online, or In a game with its mode.
 */
export function presenceNow(): PresenceReport {
  const p = presenceDetailed();
  return useFriendsPrefs.getState().showActivity ? p : privatePresence(p);
}

/** The private presence: Online, or In a game with its mode. No screen, no game detail, no watch target. */
export function privatePresence(p: PresenceReport): PresenceReport {
  return p.status === 'in_game'
    ? { status: 'in_game', mode: p.mode, watchKind: null, watchId: null }
    : { status: p.status, mode: null, watchKind: null, watchId: null };
}

const online = (mode: PresenceMode | null, activity: FriendActivity | null): PresenceReport =>
  activity ? { status: 'online', mode, watchKind: null, watchId: null, activity } : { status: 'online', mode, watchKind: null, watchId: null };

/** Whose replay: my own, a friend's (by id, from the last list), else nobody named (a stranger stays unnamed). */
function replayActivity(): FriendActivity {
  const a = useFriendsPrefs.getState().replayAuthor;
  if (a?.own) return { v: 1, act: 'replay', own: true };
  const friend = a?.id ? get().list?.friends.find((f) => f.userId === a.id) : undefined;
  const who = friend ? (friend.author ?? a?.name ?? null) : null;
  return who ? { v: 1, act: 'replay', who: who.slice(0, NAME_MAX) } : { v: 1, act: 'replay' };
}

/** The screen I am on outside a game (the top overlay first, then the ladder page, then the title's view). */
function menuActivity(g: ReturnType<typeof useGame.getState>, area: string): FriendActivity | null {
  const act = (a: ActivityKind): FriendActivity => ({ v: 1, act: a });
  if (g.showPatchNotes) return act('patch_notes');
  if (g.settingsOpen) return act('settings');
  if (g.showBook) return act('compendium');
  if (g.showCareer) return act('career');
  if (g.showRankings) return act('leaderboard');
  if (g.showLeaderboard) return act('hall');
  if (g.showRecentGames) return act('recent');
  if (g.showLiveGames) return act('live');
  if (g.showCollection) return act('collection');
  if (!g.showTitle) return null;
  switch (g.titleView) {
    case 'modes': case 'gauntlet': return act('modes');
    case 'learn': return act('learn');
    case 'versus': return act(area === 'duos' ? 'duos_browser' : 'versus_browser');
    default: return act('menu');
  }
}

/** My presence in full, before the privacy switch. */
function presenceDetailed(): PresenceReport {
  const g = useGame.getState();
  const v = useVersus.getState();
  if (v.room) {
    const vmode = normalizeVersusOptions(v.room.options).mode;
    const mode = VERSUS_MODE_OF[vmode];
    const role = myRole(v.room);
    const running = v.room.status === 'in_game' && !!v.match && v.match.phase !== 'complete';
    const seats = v.room.members.filter((m) => m.role !== 'spectator').map((m) => ({ role: m.role, name: m.displayName }));
    // VERSUS GROUP KNOCKOUT: moved to the stands, still in the match (watching the rest, with my place).
    const ko = running && v.knockout && v.knockout.matchId === v.match!.id ? v.knockout : null;
    if (running && ((role && role !== 'spectator') || ko)) {
      // R-FRIENDS-STATUS-01: my own run's vitals and tier, the match's round and phase, the room's players.
      const run = g.run.mode === 'versus' ? g.run : null;
      const m = v.match!;
      const mate = vmode === 'duos' || vmode === 'ranked_duos' ? teammateOf(role, seats) : null;
      const extras: GameExtras = {
        ending: m.phase === 'resolving' || (m.phase === 'shop' && v.lockedRound === m.round),
        mate,
        out: ko ? { place: ko.placement } : null,
      };
      if (m.phase === 'combat') extras.foe = versusFoe(vmode, role, seats, run?.lobby ?? null);
      return { status: 'in_game', mode, watchKind: 'versus', watchId: versusRoomRef(v.room), game: versusGameStatus(mode, run, m, seats, extras) };
    }
    if (running) return online('watching', { v: 1, act: 'spectate', mode, who: versusLine(mode, seats)?.slice(0, NAME_MAX) ?? null });
    const max = VERSUS_MODE_SEATS[vmode].max;
    const starting = v.room.status !== 'open';
    if (vmode === 'ranked_duos') {
      const mate = teammateOf(role, seats);
      return online('versus_room', { v: 1, act: 'duo_party', ...(mate ? { who: mate.slice(0, NAME_MAX) } : {}), players: seats.length, max, ...(starting ? { starting } : {}) });
    }
    return online('versus_room', { v: 1, act: 'versus_room', mode, players: Math.min(seats.length, max), max, ...(starting ? { starting } : {}) });
  }
  if (isWatchingLive()) {
    const who = useLiveWatch.getState().game?.display_name;
    return online('watching', who ? { v: 1, act: 'spectate', who: who.slice(0, NAME_MAX) } : { v: 1, act: 'spectate' });
  }
  if (g.replaying) return online('replay', replayActivity());
  const run = g.run;
  const inRun = !g.showTitle && !g.practiceSetupOpen && !g.heroChoices;
  const playing = inRun && (run.phase === 'recruit' || run.phase === 'combat');
  // THE END SCREEN of a lobby game: Won, or Finished Nth, until the player leaves it.
  const over = inRun && !!run.lobby && (run.phase === 'gameover' || run.phase === 'victory');
  if (playing || over) {
    let mode: PresenceMode = 'solo';
    if (run.mode === 'lobby') mode = run.sandbox || run.godMode ? 'practice' : run.lobby && lobbyIsUnrated(run.lobby) ? 'casual' : 'ranked';
    else if (run.mode === 'practice' || run.mode === 'tutorial' || run.mode === 'gauntlet') mode = run.mode;
    // EVERY lobby game (ranked, casual, Practice) is watchable through Live Games (the gate the listing uses;
    // owner 2026-10-28, R-LIVE-ALL-GAMES-01).
    const live = playing && liveEligible(run, { replaying: g.replaying, showTitle: g.showTitle });
    return {
      status: 'in_game', mode, watchKind: live ? 'live' : null, watchId: live ? rankedRunIdOf(run) : null,
      game: lobbyStatusNow(mode, run, g.endTurnAnimating),
    };
  }
  if (g.heroChoices && !g.showTitle) {
    const mode = g.pendingGauntletStage != null ? 'gauntlet' : g.pendingMode === 'practice' ? 'practice' : 'ranked';
    return online(null, { v: 1, act: 'hero_select', mode });
  }
  if (g.practiceSetupOpen) return online(null, { v: 1, act: 'practice_setup' });
  return online(null, menuActivity(g, v.area));
}

/** A 'spectate' invite's target, parsed: a live lobby / Practice game, or a Versus room (`duos` = a Ranked Duos one). */
export type SpectateTarget = { host: 'live' | 'versus' | 'duos'; id: string };
export function parseSpectateTarget(target: string): SpectateTarget | null {
  const m = /^(live|versus|duos):(.{1,58})$/.exec(target);
  return m ? { host: m[1] as SpectateTarget['host'], id: m[2] } : null;
}

/**
 * INVITE TO SPECTATE (owner 2026-10-29, R-FRIENDS-MENU-02): the game a friend would watch, when I am PLAYING one that
 * can be watched (the same gate as my presence's Watch target), else null. The privacy switch does not hide it: sending
 * the invite is my own choice to be watched.
 */
export function mySpectateTarget(): string | null {
  const p = presenceDetailed();
  if (p.status !== 'in_game' || !p.watchId) return null;
  if (p.watchKind === 'live') return `live:${p.watchId}`;
  if (p.watchKind === 'versus') return `${p.mode === 'ranked_duos' ? 'duos' : 'versus'}:${p.watchId}`;
  return null;
}

/** I am PLAYING a game of my own right now (not watching, not on a menu): leaving to watch a friend would abandon it. */
export function iAmPlaying(): boolean {
  return presenceDetailed().status === 'in_game';
}

/** My teammate in a two-player team (p1 + p2, p3 + p4). */
function teammateOf(role: string | null, seats: readonly { role: string; name: string }[]): string | null {
  const pairOf: Record<string, string> = { p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' };
  const other = role ? pairOf[role] : undefined;
  return (other && seats.find((s) => s.role === other)?.name) || null;
}

/** Who I fight in a Versus round: the other player (1v1), the other team (Duos), else the display lobby's pairing. */
function versusFoe(vmode: string, role: string | null, seats: readonly { role: string; name: string }[], lobby: RunLobby | null): string | null {
  if (vmode === 'duel') return seats.find((s) => s.role !== role)?.name ?? null;
  if (vmode === 'duos') {
    const theirs = role === 'p3' || role === 'p4' ? ['p1', 'p2'] : ['p3', 'p4'];
    return seats.filter((s) => theirs.includes(s.role)).map((s) => s.name).join(' & ').slice(0, NAME_MAX) || null;
  }
  return lobby ? lobbyFoeName(lobby) : null;
}

/** What decides that a presence send is owed: the coarse activity (never Health, Armor, tier or place on their own). */
const presenceKey = (p: PresenceReport): string =>
  `${p.status}|${p.mode ?? ''}|${p.watchKind ?? ''}|${p.watchId ?? ''}|${gameCoarseKey(p.game ?? null)}|${activityKey(p.activity)}`;

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

// ── my presence, sent to the hub (R-FRIENDS-HUB-LIVE-01) ─────────────────────────────────────────────────

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastAt = -Infinity;
let lastKey = '';
/** A change send is armed (the settle is running). */
let changePending = false;

function clearTimer(): void { if (timer !== null) { clearTimeout(timer); timer = null; } }
function schedule(ms: number): void {
  clearTimer();
  timer = setTimeout(() => { timer = null; announce(); }, Math.max(0, ms));
}

/** Who hears my presence when it settles (the hub socket, `dm/dmStore.ts`). */
type PresenceListener = (p: PresenceReport) => void;
const presenceListeners = new Set<PresenceListener>();
export function onPresenceSettled(f: PresenceListener): () => void {
  presenceListeners.add(f);
  return () => { presenceListeners.delete(f); };
}

/** My presence settled on something new: tell the listeners (the hub), never more often than the gap. */
function announce(): void {
  if (!started || !friendsAccount() || !get().deployed) return;
  const now = Date.now();
  if (now - lastAt < PRESENCE_MIN_GAP_MS) { schedule(lastAt + PRESENCE_MIN_GAP_MS - now); return; }
  changePending = false;
  const p = presenceNow();
  const key = presenceKey(p);
  if (key === lastKey) return;
  lastAt = now;
  lastKey = key;
  for (const f of presenceListeners) { try { f(p); } catch { /* a listener never stops the others */ } }
}

/**
 * My status may have changed: send it once it SETTLES (R-FRIENDS-ACTIVITY-01). Each change re-arms a short settle
 * (`CHANGE_SETTLE_MS`), so rapid screen flips (sidebar hops, a quick look at Settings) send once, for where I land,
 * and flipping straight back sends nothing. Never faster than `PRESENCE_MIN_GAP_MS`.
 */
function onMaybeChanged(): void {
  if (!started || !friendsAccount()) return;
  const now = Date.now();
  if (presenceKey(presenceNow()) === lastKey) {
    // Back where the last send left me: the pending one is not owed any more.
    if (changePending) { changePending = false; clearTimer(); }
    return;
  }
  changePending = true;
  schedule(Math.max(now + CHANGE_SETTLE_MS, lastAt + PRESENCE_MIN_GAP_MS) - now);
}

/** The presence the hub was last told about (the hub's hello sends the current one itself). */
export function notePresenceSent(p: PresenceReport): void {
  lastKey = presenceKey(p);
  lastAt = Date.now();
}

// ── my inbox: read when the hub says it changed ──────────────────────────────────────────────────────────

let inboxTimer: ReturnType<typeof setTimeout> | null = null;
let inboxLastAt = -Infinity;
let inboxInFlight = false;
let inboxOwed = false;

/**
 * Something in my inbox may have changed (the hub pushed `inbox`, the hub socket (re)opened, I signed in): read it, as
 * one `friends_list` call. A burst is coalesced into one read now and one trailing read (`INBOX_MIN_GAP_MS`).
 */
export function nudgeInbox(): void {
  if (!started || !friendsAccount() || !get().deployed) return;
  if (inboxInFlight) { inboxOwed = true; return; }
  const wait = inboxLastAt + INBOX_MIN_GAP_MS - Date.now();
  if (wait > 0) {
    if (inboxTimer === null) inboxTimer = setTimeout(() => { inboxTimer = null; nudgeInbox(); }, wait);
    return;
  }
  inboxLastAt = Date.now();
  inboxInFlight = true;
  void refreshFriendsList().finally(() => {
    inboxInFlight = false;
    if (inboxOwed) { inboxOwed = false; nudgeInbox(); }
  });
}

/** Tell another player's hub their inbox changed because of me (`dm/dmStore.ts` registers the hub's nudge). */
export type HubNotifier = (to: string, kind: 'friends' | 'invite') => void;
let hubNotify: HubNotifier | null = null;
export function setHubNotifier(f: HubNotifier | null): void { hubNotify = f; }
function notify(to: string | null | undefined, kind: 'friends' | 'invite'): void {
  if (!to || !hubNotify) return;
  try { hubNotify(to, kind); } catch { /* best effort: they read it on their next list */ }
}

/** The store fields the activity reads (screens, overlays, the pick, the End Turn). */
const GAME_FIELDS = [
  'showTitle', 'titleView', 'settingsOpen', 'showLeaderboard', 'showRankings', 'showRecentGames', 'showLiveGames',
  'showCareer', 'showCollection', 'showBook', 'showPatchNotes', 'practiceSetupOpen', 'replaying', 'heroChoices', 'pendingMode',
  'endTurnAnimating',
] as const;

/** Start presence + inbox (once, at boot). Returns a stop function (tests). */
export function startFriendsPresence(): () => void {
  if (started || typeof window === 'undefined') return () => undefined;
  started = true;
  const unGame = useGame.subscribe((s, prev) => {
    if (s.account.userId !== prev.account.userId || s.account.anonymous !== prev.account.anonymous) {
      // A new identity (sign in, sign out, a guest saved): start over at once.
      lastAt = -Infinity; lastKey = ''; inboxLastAt = -Infinity; changePending = false;
      clearTimer();
      set({ inbox: null, list: null });
      nudgeInbox();
      return;
    }
    // Identity compares on the few fields the activity reads (no derivation on an unrelated store write).
    if (GAME_FIELDS.some((k) => s[k] !== prev[k]) || s.run.mode !== prev.run.mode || s.run.phase !== prev.run.phase
      || s.run.wave !== prev.run.wave) onMaybeChanged();
  });
  const unVs = useVersus.subscribe((s, prev) => {
    if (s.room?.id !== prev.room?.id || s.room?.status !== prev.room?.status || s.match?.phase !== prev.match?.phase
      || s.match?.round !== prev.match?.round || s.room?.members.length !== prev.room?.members.length
      || s.room?.options?.mode !== prev.room?.options?.mode || s.lockedRound !== prev.lockedRound || s.knockout !== prev.knockout
      || s.area !== prev.area) onMaybeChanged();
  });
  const unLive = useLiveWatch.subscribe((s, prev) => { if (s.game?.game_id !== prev.game?.game_id) onMaybeChanged(); });
  const unPrefs = useFriendsPrefs.subscribe((s, prev) => {
    if (s.showActivity !== prev.showActivity || s.replayAuthor !== prev.replayAuthor) onMaybeChanged();
  });
  // The first inbox read, after boot settles (the session lands first). The hub's hello asks too; they coalesce.
  const boot = setTimeout(() => nudgeInbox(), 1500);
  return () => {
    started = false;
    clearTimer();
    clearTimeout(boot);
    if (inboxTimer !== null) { clearTimeout(inboxTimer); inboxTimer = null; }
    unGame(); unVs(); unLive(); unPrefs();
  };
}

/** Tests: forget the loop's memory. */
export function resetFriendsForTests(): void {
  clearTimer();
  if (inboxTimer !== null) { clearTimeout(inboxTimer); inboxTimer = null; }
  started = false; lastAt = -Infinity; lastKey = ''; changePending = false; resetFoeCacheForTests();
  inboxLastAt = -Infinity; inboxInFlight = false; inboxOwed = false;
  presenceListeners.clear();
  hubNotify = null;
  remote = friendsRemote;
  proofSource = defaultProofSource;
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
    // The list carries the inbox (requests, invites): keep it in step without another call.
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

async function act<T>(id: string, run: () => Promise<T>, ok?: string, nudge?: { kind: 'friends' | 'invite'; to: (r: T) => string | null | undefined }): Promise<T | null> {
  if (get().busy[id]) return null;
  set({ busy: { ...get().busy, [id]: true } });
  try {
    const r = await run();
    if (ok) flashFriends(ok);
    // Their inbox changed: their hub tells their open games at once (R-FRIENDS-HUB-LIVE-01).
    if (nudge) notify(nudge.to(r), nudge.kind);
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
  const r = await act(`handle:${h}`, () => remote.requestByHandle(h), undefined, { kind: 'friends', to: (x) => x.userId });
  if (r) flashFriends(r.status === 'accepted' ? 'You are now friends.' : 'Friend request sent.');
  return !!r;
}
export async function addFriend(userId: string): Promise<boolean> {
  const r = await act(userId, () => remote.requestById(userId), undefined, { kind: 'friends', to: () => userId });
  if (r) flashFriends(r.status === 'accepted' ? 'You are now friends.' : 'Friend request sent.');
  return !!r;
}
const theirs = (userId: string) => ({ kind: 'friends' as const, to: () => userId });
export const acceptRequest = (userId: string): Promise<unknown> => act(userId, () => remote.respond(userId, true), 'You are now friends.', theirs(userId));
export const declineRequest = (userId: string): Promise<unknown> => act(userId, () => remote.respond(userId, false), undefined, theirs(userId));
export const cancelRequest = (userId: string): Promise<unknown> => act(userId, () => remote.cancel(userId), undefined, theirs(userId));
export const removeFriend = (userId: string): Promise<unknown> => act(userId, () => remote.remove(userId), 'Friend removed.', theirs(userId));
export const blockPlayer = (userId: string): Promise<unknown> => act(userId, () => remote.block(userId), 'Player blocked.', theirs(userId));
export const unblockPlayer = (userId: string): Promise<unknown> => act(userId, () => remote.unblock(userId), 'Player unblocked.', theirs(userId));

/**
 * THE INVITE API (Versus rooms now; the Ranked Duos party uses the same call with kind 'duos_party' and its party id).
 * The server checks the friendship, that the friend is online, and the target (a Versus room: one I am in and open).
 */
export async function inviteFriend(userId: string, kind: InviteKind, target: string): Promise<boolean> {
  const r = await act(`invite:${userId}`, async () => remote.invite(userId, kind, target, await inviteProofFor(userId, kind, target)), 'Invite sent.',
    { kind: 'invite', to: () => userId });
  return !!r;
}

/** Tests: a fake room check. */
const defaultProofSource = (roomId: string, to: string, kind: InviteKind): Promise<string | null> => versusRemote.inviteProof(roomId, to, kind);
let proofSource = defaultProofSource;
export function setInviteProofSourceForTests(f: typeof proofSource): void { proofSource = f; }

/**
 * A CLOUDFLARE room's invite carries the room's own signed check (R-VERSUS-CF-INVITE-01): asked of the room on the socket
 * I already hold, right before `friends_invite`, which refuses a `cf:` invite without it. The room answers the same codes
 * the SQL does for a Supabase room (`room_not_open`, `not_in_room`, `already_in_room`), so the flash reads the same.
 * A Supabase room needs none (null).
 */
export async function inviteProofFor(userId: string, kind: InviteKind, target: string): Promise<string | null> {
  let ref = target;
  if (kind === 'spectate') {
    // A live lobby game needs no proof (its id is checked for form only since the Supabase list retired); a Versus room is checked by its host.
    const t = parseSpectateTarget(target);
    if (!t || t.host === 'live') return null;
    ref = t.id;
  }
  const { roomId, host } = decodeRoomRef(ref);
  if (host !== 'cf') return null;
  const proof = await proofSource(roomId, userId, kind);
  if (!proof) throw new FriendsError('room_check');
  return proof;
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
