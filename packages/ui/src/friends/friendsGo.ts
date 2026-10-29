/**
 * FRIENDS: going somewhere with a friend, through the EXISTING paths only (owner 2026-10-26; R-FRIENDS-04).
 *  - Accepting a Versus room invite opens Versus and joins the room (`joinRoom`, the room browser's own Join).
 *  - Watch on a friend in a ranked game: Live Games' own `watchLiveGame`. Watch on a friend in a Versus match: join
 *    their room in the stands (`joinRoom(..., 'spectator')`, every room is watchable, ruling 8).
 * `installFriendInvites` registers the built-in 'versus_room' invite handler (the Ranked Duos party registers its own).
 */
import { normalizeVersusOptions, VERSUS_MODE_SEATS } from '@game/sim';
import { isPreRun, PAGES_CLOSED, useGame } from '../store';
import { createRoom, enterDuosParty, isDuosParty, joinRoom, leaveRoom, openVersus, useVersus } from '../versus/versusStore';
import { versusRemote, versusRoomRef, type VersusRoom } from '../versus/versusRemote';
import { defaultPartyName } from '../versus/playParty';
import { defaultRoomName } from '../versus/VersusTitle';
import { decodeRoomRef } from '../versus/versusHost';
import { versusEnabled } from '../versus/versusFlag';
import { watchLiveGame } from '../live/liveWatch';
import type { LiveGameRow } from '../live/liveRemote';
import type { LiveWatchTarget } from '../live/liveTargets';
import { endReplay } from '../replay/replayPlayer';
import { blockPlayer, flashFriends, iAmPlaying, inviteFriend, mySpectateTarget, parseSpectateTarget, registerInviteHandler, removeFriend } from './friendsStore';
import type { Friend, FriendInvite } from './friendsRemote';

/** Open Versus and enter a room (as a player: into the room's hand, a seat one drag away; or in the stands). */
export async function goToVersusRoom(ref: string, as: 'player' | 'spectator', area: 'versus' | 'duos' = 'versus'): Promise<boolean> {
  if (!versusEnabled()) { flashFriends('Versus is not available on this build.'); return false; }
  // THE CUTOVER (R-VERSUS-CF-CUTOVER-01): an invite / Watch id / Live Games row names a Cloudflare room `cf:<id>`.
  const { roomId, host } = decodeRoomRef(ref);
  versusRemote.noteRoomHost(roomId, host);
  let vs = useVersus.getState();
  // A party invite while I wait in my own party (nothing started there, so leaving is free): swap parties
  // (R-RANKED-DUOS-SPLIT-01). Any other room I hold stays mine until I leave it.
  if (area === 'duos' && vs.room && vs.room.id !== roomId && isDuosParty(vs.room) && vs.room.status === 'open') {
    await leaveRoom();
    vs = useVersus.getState();
  }
  if (vs.room && vs.room.id !== roomId) { flashFriends(isDuosParty(vs.room) ? 'Leave your party first.' : 'Leave your Versus room first.'); return false; }
  const g = useGame.getState();
  g.goTo('menu'); // closes every ladder page
  openVersus(area);
  if (vs.room?.id === roomId) return true;
  await joinRoom(roomId, as);
  return useVersus.getState().room?.id === roomId;
}

export async function acceptVersusRoomInvite(invite: FriendInvite): Promise<void> {
  await goToVersusRoom(invite.target, 'player');
}

/**
 * THE ONE WATCH PATH (owner 2026-10-29: "clicking watch from friends list doesnt bring the player into the game, the game
 * happens behind the screen"; R-WATCH-ENTERS-01). Live Games' Watch, a friend's Watch / Spectate (the dock, the friend
 * menu) and an accepted spectate invite all come here, from any screen: a replay being viewed is left first (its restore
 * would land over the watch), then the game is joined (a lobby / Practice game: the live watch screen, either host; a
 * Versus or Ranked Duos match: its room's stands), and once joined EVERY page that could sit over the watch closes
 * (Career, Recent Games, Live Games, Rankings, the Hall, Collection, Settings, the Practice setup, the in-game menu). A failed join
 * leaves the screen as it was (Live Games shows why). `hint`: the game's listing row, when the caller has it.
 */
export async function watchGame(t: LiveWatchTarget, hint?: Pick<LiveGameRow, 'live_host'> | null): Promise<boolean> {
  if (useGame.getState().replaySession) endReplay();
  const ok = t.kind === 'room' ? await goToVersusRoom(t.ref, 'spectator', t.area) : await watchLiveGame(t.gameId, hint);
  if (ok) closeScreensOverWatch();
  return ok;
}

/** Every page that would paint over the watch screen, closed (the title itself is the watch screen's own business). */
export function closeScreensOverWatch(): void {
  useGame.setState({ ...PAGES_CLOSED, practiceSetupOpen: false, gameMenuOpen: false });
}

/** Watch a friend's game, when it is watchable. Resolves true when the watch started. */
export async function watchFriend(f: Partial<Pick<Friend, 'watchKind' | 'watchId' | 'mode'>>): Promise<boolean> {
  if (!f.watchId) return false;
  if (f.watchKind === 'live') return watchGame({ kind: 'lobby', gameId: f.watchId });
  // A Ranked Duos party lives in the Duos area: watching it from the Versus area would never show it (R-RANKED-DUOS-SPLIT-01).
  if (f.watchKind === 'versus') return watchGame({ kind: 'room', ref: f.watchId, area: watchAreaOf(f.mode) });
  return false;
}

/** The play area a friend's Versus game is watched from (R-LIVE-ALL-GAMES-01): Ranked Duos in Duos, the rest in Versus. */
export const watchAreaOf = (mode: string | null | undefined): 'versus' | 'duos' => (mode === 'ranked_duos' ? 'duos' : 'versus');

/** RANKED DUOS (phase 3): accepting a party invite opens the Duos play area and takes the party's free seat. */
export async function acceptDuosPartyInvite(invite: FriendInvite): Promise<void> {
  await goToVersusRoom(invite.target, 'player', 'duos');
}

/**
 * ACCEPTING "INVITE TO SPECTATE" (owner 2026-10-29, R-FRIENDS-MENU-02): straight into watching their game, through the
 * existing Watch paths: a lobby / Practice game through Live Games (either host, `watchLiveGame`), a Versus or Ranked
 * Duos match through its room's stands (`goToVersusRoom(..., 'spectator')`, either host).
 */
export async function acceptSpectateInvite(invite: FriendInvite): Promise<void> {
  const t = parseSpectateTarget(invite.target);
  if (!t) { flashFriends('That game is not available.'); return; }
  const ok = t.host === 'live'
    ? await watchFriend({ watchKind: 'live', watchId: t.id })
    : await watchFriend({ watchKind: 'versus', watchId: t.id, mode: t.host === 'duos' ? 'ranked_duos' : null });
  if (!ok) flashFriends('That game has ended.');
}

// ── THE FRIEND MENU (owner 2026-10-29, R-FRIENDS-MENU-01): right-click / long-press on a friend row ───────────────

export type FriendMenuAction = 'spectate' | 'invite_lobby' | 'invite_duos' | 'invite_spectate' | 'remove' | 'block';
export interface FriendMenuEntry {
  id: FriendMenuAction;
  label: string;
  /** Shown but not pressable, with this short reason (a room invite while I am mid-game). */
  disabled?: string;
  /** A harmful entry (Remove friend, Block): set apart at the bottom, and the first press only arms it, showing this
   *  label; the second press acts (R-FRIENDS-MENU-03). */
  confirm?: string;
}

/** The last two entries of every friend's menu (owner 2026-10-29, R-FRIENDS-MENU-03): the row no longer shows them. */
export const FRIEND_MENU_HARM: readonly FriendMenuEntry[] = [
  { id: 'remove', label: 'Remove friend', confirm: 'Remove? Press again' },
  { id: 'block', label: 'Block', confirm: 'Block? Press again' },
];

/** What the menu needs to know about ME right now (pure inputs, so the entries are testable). */
export interface FriendMenuContext {
  /** Versus is on in this build (rooms and parties exist). */
  versus: boolean;
  /** I am in a game right now (playing, spectating or replaying): a room invite would abandon it. */
  inGame: boolean;
  /** I am PLAYING my own game: watching a friend would abandon it (watching someone else, I may switch). */
  playing: boolean;
  /** The room I hold, if any. */
  room: Pick<VersusRoom, 'status' | 'options' | 'members'> | null;
  /** My game a friend could watch (`mySpectateTarget`), or null. */
  spectate: string | null;
}

export const FINISH_FIRST = 'Finish your game first';

/** A party with a free seat (a Ranked Duos party is two players). */
export function partyHasSeat(room: Pick<VersusRoom, 'options' | 'members'>): boolean {
  const max = VERSUS_MODE_SEATS[normalizeVersusOptions(room.options).mode].max;
  return room.members.filter((m) => m.role !== 'spectator').length < max;
}

/**
 * The entries that make sense right now, in a fixed order. Only an Online friend can be invited (the server refuses
 * the rest, R-FRIENDS-04); a friend already in a Versus room is not offered a room. Room invites while I am in a game
 * show disabled with the reason (owner 2026-10-29: never abandon a match).
 */
export function friendMenuEntries(f: Pick<Friend, 'status' | 'mode' | 'watchKind' | 'watchId'>, ctx: FriendMenuContext): FriendMenuEntry[] {
  const out: FriendMenuEntry[] = [];
  if (f.status === 'in_game' && f.watchId && (f.watchKind === 'live' || f.watchKind === 'versus')) {
    out.push(ctx.playing ? { id: 'spectate', label: 'Spectate', disabled: FINISH_FIRST } : { id: 'spectate', label: 'Spectate' });
  }
  if (f.status === 'online') out.push(...onlineEntries(f, ctx));
  // Remove friend and Block, always, last (R-FRIENDS-MENU-03).
  out.push(...FRIEND_MENU_HARM);
  return out;
}

function onlineEntries(f: Pick<Friend, 'mode'>, ctx: FriendMenuContext): FriendMenuEntry[] {
  const out: FriendMenuEntry[] = [];
  if (ctx.versus && f.mode !== 'versus_room') {
    const room = ctx.room;
    const busy = ctx.inGame || (!!room && room.status !== 'open') ? FINISH_FIRST : undefined;
    // Invite to lobby: my open Versus room, or a new one. Invite to Duos: my open party with a free seat, or a new one.
    out.push(busy ? { id: 'invite_lobby', label: 'Invite to lobby', disabled: busy } : { id: 'invite_lobby', label: 'Invite to lobby' });
    const fullParty = !!room && isDuosParty(room) && room.status === 'open' && !partyHasSeat(room);
    const duosOff = busy ?? (fullParty ? 'Your party is full' : undefined);
    out.push(duosOff ? { id: 'invite_duos', label: 'Invite to Duos', disabled: duosOff } : { id: 'invite_duos', label: 'Invite to Duos' });
  }
  if (ctx.spectate) out.push({ id: 'invite_spectate', label: 'Invite to spectate' });
  return out;
}

/** My menu context from the stores (read once, when the menu opens). */
export function friendMenuContext(): FriendMenuContext {
  const g = useGame.getState();
  return {
    versus: versusEnabled(),
    inGame: !isPreRun(g) || g.replaying,
    playing: iAmPlaying(),
    room: useVersus.getState().room,
    spectate: mySpectateTarget(),
  };
}

/** The open room of an area that I already hold, or null. */
function heldOpen(area: 'versus' | 'duos'): VersusRoom | null {
  const r = useVersus.getState().room;
  return r && r.status === 'open' && isDuosParty(r) === (area === 'duos') ? r : null;
}

/**
 * INVITE TO LOBBY / INVITE TO DUOS (owner 2026-10-29: "it will instantly put me in a duo room and he joins when he
 * accepts. Same for lobby"): the room I already hold, else a NEW one made through the normal create flow (Versus:
 * `createRoom`, default options, on the host the per-mode switch picks; Duos: `enterDuosParty`, the Duo + Play party),
 * which takes me there; then the invite. A decline or an expiry leaves me in my room. Never from inside a game.
 */
export async function inviteToRoom(userId: string, area: 'versus' | 'duos'): Promise<boolean> {
  if (!versusEnabled()) { flashFriends('Versus is not available on this build.'); return false; }
  const ctx = friendMenuContext();
  if (ctx.inGame || (ctx.room && ctx.room.status !== 'open')) { flashFriends(`${FINISH_FIRST}.`); return false; }
  const g = useGame.getState();
  let room = heldOpen(area);
  if (!room) {
    const name = g.playerName;
    g.goTo('menu'); // closes every ladder page
    if (area === 'duos') await enterDuosParty(defaultPartyName(name));
    else { openVersus('versus'); await createRoom(defaultRoomName(name)); }
    room = heldOpen(area);
    if (!room) { flashFriends(useVersus.getState().error ?? 'Could not open a room.'); return false; }
  } else if (!(g.showTitle && g.titleView === 'versus' && useVersus.getState().area === area)) {
    // Already in it: show it, so the answer lands where I can see it.
    g.goTo('menu');
    openVersus(area);
  }
  return inviteFriend(userId, area === 'duos' ? 'duos_party' : 'versus_room', versusRoomRef(room));
}

/** INVITE TO SPECTATE: the game I am playing right now. */
export async function inviteToSpectate(userId: string): Promise<boolean> {
  const target = mySpectateTarget();
  if (!target) { flashFriends('Start a game first.'); return false; }
  return inviteFriend(userId, 'spectate', target);
}

/** Run a menu entry. */
export function runFriendMenu(action: FriendMenuAction, f: Friend): Promise<boolean> {
  switch (action) {
    case 'spectate':
      if (iAmPlaying()) { flashFriends(`${FINISH_FIRST}.`); return Promise.resolve(false); }
      return watchFriend(f);
    case 'invite_lobby': return inviteToRoom(f.userId, 'versus');
    case 'invite_duos': return inviteToRoom(f.userId, 'duos');
    case 'invite_spectate': return inviteToSpectate(f.userId);
    // The existing friends API (block also stops their messages and invites, server side).
    case 'remove': return removeFriend(f.userId).then(() => true);
    case 'block': return blockPlayer(f.userId).then(() => true);
  }
}

let installed = false;
/** Register the built-in invite handlers (once, at boot). */
export function installFriendInvites(): void {
  if (installed) return;
  installed = true;
  registerInviteHandler('versus_room', acceptVersusRoomInvite);
  registerInviteHandler('duos_party', acceptDuosPartyInvite);
  registerInviteHandler('spectate', acceptSpectateInvite);
}
